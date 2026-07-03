import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, printAccessTokens } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3001);
const db = createDatabase(process.env.DB_FILE || path.join(__dirname, "..", "voting.sqlite"));

printAccessTokens(db);
writeFelipeCredentials();

const app = express();
app.use(express.json());

function writeFelipeCredentials() {
  const row = db
    .prepare(`
      SELECT Person.name, Team.name AS teamName, AccessToken.access_token AS token
      FROM AccessToken
      JOIN Person ON Person.id = AccessToken.person_id
      JOIN Team ON Team.id = Person.team_id
      WHERE Person.name = 'Felipe Didio'
    `)
    .get();

  if (!row) {
    throw new Error("Felipe Didio seed user is missing.");
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const credentials = {
    name: row.name,
    teamName: row.teamName,
    token: row.token,
    url: `${publicBaseUrl}/?token=${encodeURIComponent(row.token)}`
  };

  const credentialsPath = path.join(__dirname, "..", "felipe-didio-credentials.json");
  fs.writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
  console.log(`Felipe Didio credentials written to ${credentialsPath}`);
}

function personForToken(token) {
  if (!token) return null;
  return db
    .prepare(`
      SELECT Person.id, Person.name, Team.id AS teamId, Team.name AS teamName, Team.team_group AS teamGroup
      FROM AccessToken
      JOIN Person ON Person.id = AccessToken.person_id
      JOIN Team ON Team.id = Person.team_id
      WHERE AccessToken.access_token = ?
    `)
    .get(token);
}

function requirePerson(req, res, next) {
  const token = req.get("x-access-token") || req.query.token;
  const person = personForToken(token);
  if (!person) {
    return res.status(401).json({ error: "Invalid or missing access token." });
  }
  req.person = person;
  next();
}

app.get("/api/session", requirePerson, (req, res) => {
  const teams = db
    .prepare(`
      SELECT id, name, team_group AS teamGroup
      FROM Team
      WHERE id <> ?
      ORDER BY name
    `)
    .all(req.person.teamId);

  const votes = db
    .prepare(`
      SELECT voted_on_team_id AS teamId,
        category_1_score AS category1,
        category_2_score AS category2,
        category_3_score AS category3
      FROM Vote
      WHERE voting_person_id = ?
    `)
    .all(req.person.id);

  const canReport = req.person.name === "Felipe Didio";
  const accessTokens = canReport
    ? db
        .prepare(`
          SELECT Person.name, Team.name AS teamName, AccessToken.access_token AS token
          FROM AccessToken
          JOIN Person ON Person.id = AccessToken.person_id
          JOIN Team ON Team.id = Person.team_id
          ORDER BY Team.name, Person.name
        `)
        .all()
    : [];

  res.json({
    person: req.person,
    canReport,
    accessTokens,
    teams,
    votes
  });
});

app.post("/api/votes", requirePerson, (req, res) => {
  const votes = Array.isArray(req.body?.votes) ? req.body.votes : [];
  const allowedTeamIds = new Set(
    db.prepare("SELECT id FROM Team WHERE id <> ?").all(req.person.teamId).map((team) => team.id)
  );

  if (votes.length !== allowedTeamIds.size) {
    return res.status(400).json({ error: "Every eligible team needs all three scores." });
  }

  for (const vote of votes) {
    const scores = [vote.category1, vote.category2, vote.category3];
    if (!allowedTeamIds.has(vote.teamId) || scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
      return res.status(400).json({ error: "Votes must target eligible teams and use scores from 1 to 5." });
    }
  }

  const upsert = db.prepare(`
    INSERT INTO Vote (
      voting_person_id,
      voted_on_team_id,
      category_1_score,
      category_2_score,
      category_3_score
    )
    VALUES (@personId, @teamId, @category1, @category2, @category3)
    ON CONFLICT(voting_person_id, voted_on_team_id)
    DO UPDATE SET
      category_1_score = excluded.category_1_score,
      category_2_score = excluded.category_2_score,
      category_3_score = excluded.category_3_score,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.transaction(() => {
    for (const vote of votes) {
      upsert.run({ ...vote, personId: req.person.id });
    }
  })();

  res.json({ ok: true });
});

app.get("/api/report", requirePerson, (req, res) => {
  if (req.person.name !== "Felipe Didio") {
    return res.status(403).json({ error: "Only Felipe Didio can view the report." });
  }

  const rows = db
    .prepare(`
      SELECT
        Team.id AS teamId,
        Team.name AS teamName,
        voters.team_group AS voterGroup,
        AVG(Vote.category_1_score) AS category1Average,
        AVG(Vote.category_2_score) AS category2Average,
        AVG(Vote.category_3_score) AS category3Average
      FROM Team
      LEFT JOIN Vote ON Vote.voted_on_team_id = Team.id
      LEFT JOIN Person ON Person.id = Vote.voting_person_id
      LEFT JOIN Team voters ON voters.id = Person.team_id
      WHERE Team.team_group <> 'Jury'
      GROUP BY Team.id, voters.team_group
      ORDER BY Team.name
    `)
    .all();

  const byTeam = new Map();
  for (const row of rows) {
    if (!byTeam.has(row.teamId)) {
      byTeam.set(row.teamId, {
        teamId: row.teamId,
        teamName: row.teamName,
        category1: null,
        category2: null,
        category3: null,
        overall: null,
        groups: {}
      });
    }
    if (row.voterGroup) {
      byTeam.get(row.teamId).groups[row.voterGroup] = {
        category1: row.category1Average,
        category2: row.category2Average,
        category3: row.category3Average
      };
    }
  }

  const report = [...byTeam.values()].map((team) => {
    const jury = team.groups.Jury || {};
    const attendees = team.groups.Attendees || {};
    const category1 = combineGroupAverages(jury.category1, attendees.category1);
    const category2 = combineGroupAverages(jury.category2, attendees.category2);
    const category3 = combineGroupAverages(jury.category3, attendees.category3);
    const overall = [category1, category2, category3].every((score) => score !== null)
      ? 0.4 * category1 + 0.4 * category2 + 0.2 * category3
      : null;

    return {
      ...team,
      category1,
      category2,
      category3,
      overall
    };
  });

  report.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.teamName.localeCompare(b.teamName));
  res.json({ report });
});

function combineGroupAverages(juryAverage, attendeeAverage) {
  if (juryAverage == null || attendeeAverage == null) return null;
  return (Number(juryAverage) + Number(attendeeAverage)) / 2;
}

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(port, () => {
  console.log(`Voting server listening on http://localhost:${port}`);
});
