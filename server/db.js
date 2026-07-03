import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { people, teams } from "./seedData.js";

export function createDatabase(filename = "voting.sqlite") {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS Team (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      team_group TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Person (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES Team(id)
    );

    CREATE TABLE IF NOT EXISTS Vote (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voting_person_id TEXT NOT NULL REFERENCES Person(id),
      voted_on_team_id INTEGER NOT NULL REFERENCES Team(id),
      category_1_score INTEGER NOT NULL CHECK (category_1_score BETWEEN 1 AND 5),
      category_2_score INTEGER NOT NULL CHECK (category_2_score BETWEEN 1 AND 5),
      category_3_score INTEGER NOT NULL CHECK (category_3_score BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(voting_person_id, voted_on_team_id)
    );

    CREATE TABLE IF NOT EXISTS AccessToken (
      person_id TEXT PRIMARY KEY REFERENCES Person(id),
      access_token TEXT NOT NULL UNIQUE
    );
  `);

  seed(db);
  return db;
}

function seed(db) {
  const seedTeamNames = teams.map((team) => team.name);
  const seedPersonIds = people.map((person) => person.id);
  const teamPlaceholders = seedTeamNames.map(() => "?").join(", ");
  const personPlaceholders = seedPersonIds.map(() => "?").join(", ");

  const upsertTeam = db.prepare(`
    INSERT INTO Team (name, team_group)
    VALUES (@name, @group)
    ON CONFLICT(name) DO UPDATE SET team_group = excluded.team_group
  `);

  const teamByName = db.prepare("SELECT id FROM Team WHERE name = ?");
  const upsertPerson = db.prepare(`
    INSERT INTO Person (id, name, team_id)
    VALUES (@id, @name, @teamId)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, team_id = excluded.team_id
  `);

  const tokenExists = db.prepare("SELECT 1 FROM AccessToken WHERE person_id = ?");
  const insertToken = db.prepare("INSERT INTO AccessToken (person_id, access_token) VALUES (?, ?)");
  const deleteStaleVotes = db.prepare(`
    DELETE FROM Vote
    WHERE voting_person_id NOT IN (${personPlaceholders})
      OR voted_on_team_id IN (SELECT id FROM Team WHERE name NOT IN (${teamPlaceholders}))
  `);
  const deleteStaleTokens = db.prepare(`DELETE FROM AccessToken WHERE person_id NOT IN (${personPlaceholders})`);
  const deleteStalePeople = db.prepare(`DELETE FROM Person WHERE id NOT IN (${personPlaceholders})`);
  const deleteStaleTeams = db.prepare(`DELETE FROM Team WHERE name NOT IN (${teamPlaceholders})`);

  const tx = db.transaction(() => {
    for (const team of teams) {
      upsertTeam.run(team);
    }

    for (const person of people) {
      const team = teamByName.get(person.teamName);
      if (!team) {
        throw new Error(`Seed person "${person.name}" references missing team "${person.teamName}"`);
      }
      upsertPerson.run({ id: person.id, name: person.name, teamId: team.id });
      if (!tokenExists.get(person.id)) {
        insertToken.run(person.id, nanoid(24));
      }
    }

    deleteStaleVotes.run(...seedPersonIds, ...seedTeamNames);
    deleteStaleTokens.run(...seedPersonIds);
    deleteStalePeople.run(...seedPersonIds);
    deleteStaleTeams.run(...seedTeamNames);
  });

  tx();
}

export function printAccessTokens(db) {
  const rows = db
    .prepare(`
      SELECT Person.name, AccessToken.access_token AS token
      FROM AccessToken
      JOIN Person ON Person.id = AccessToken.person_id
      ORDER BY Person.name
    `)
    .all();

  console.log("\nAccess tokens");
  console.table(rows);
}
