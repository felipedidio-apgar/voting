import { Award, BarChart3, Check, KeyRound, Loader2, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const categories = [
  { key: "category1", label: "Uso de Assistente IA", weight: "40%" },
  { key: "category2", label: "Apresentação e Reflexão", weight: "40%" },
  { key: "category3", label: "Trabalho em Equipe", weight: "20%" }
];

function App() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [session, setSession] = useState(null);
  const [scores, setScores] = useState({});
  const [status, setStatus] = useState({ type: "loading", text: "Loading ballot" });
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus({ type: "unsigned", text: "" });
      return;
    }

    fetch("/api/session", { headers: { "x-access-token": token } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error);
        return response.json();
      })
      .then((data) => {
        const initialScores = {};
        for (const vote of data.votes) {
          initialScores[vote.teamId] = {
            category1: vote.category1,
            category2: vote.category2,
            category3: vote.category3
          };
        }
        setSession(data);
        setScores(initialScores);
        setStatus({ type: "idle", text: "" });
      })
      .catch((error) => setStatus({ type: "error", text: error.message }));
  }, [token]);

  const completedTeams = useMemo(() => {
    if (!session) return 0;
    return session.teams.filter((team) => categories.every((category) => scores[team.id]?.[category.key])).length;
  }, [scores, session]);

  const canSubmit = Boolean(session) && completedTeams === session.teams.length;

  function setScore(teamId, categoryKey, score) {
    setScores((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        [categoryKey]: score
      }
    }));
  }

  async function submitVotes() {
    setStatus({ type: "saving", text: "Saving ballot" });
    const payload = {
      votes: session.teams.map((team) => ({
        teamId: team.id,
        category1: scores[team.id]?.category1,
        category2: scores[team.id]?.category2,
        category3: scores[team.id]?.category3
      }))
    };

    const response = await fetch("/api/votes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-access-token": token
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.json();
      setStatus({ type: "error", text: body.error });
      return;
    }

    setStatus({ type: "saved", text: "Ballot saved" });
  }

  async function loadReport() {
    setReportLoading(true);
    const response = await fetch("/api/report", { headers: { "x-access-token": token } });
    const body = await response.json();
    setReportLoading(false);
    if (!response.ok) {
      setStatus({ type: "error", text: body.error });
      return;
    }
    setReport(body.report);
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-ink/15 pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-ink/20 bg-white/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-moss">
                <Award size={14} />
                Competition Voting
              </div>
              <h1 className="font-display text-4xl leading-tight sm:text-5xl">
                Score every team with care.
              </h1>
            </div>
            {session && (
              <div className="min-w-56 border-l-4 border-brass bg-white/55 p-4 shadow-line">
                <p className="text-sm text-ink/60">Voting as</p>
                <p className="font-display text-2xl">{session.person.name}</p>
                <p className="text-sm text-ink/70">{session.person.teamName}</p>
              </div>
            )}
          </div>
        </header>

        {status.type === "unsigned" && <UnsignedUser />}
        {status.type === "loading" && <Notice icon={<Loader2 className="animate-spin" />} text={status.text} />}
        {status.type === "error" && <Notice tone="error" text={status.text} />}

        {session && (
          <>
            <section className="grid gap-3">
              {session.teams.map((team, index) => (
                <TeamVote
                  key={team.id}
                  index={index + 1}
                  team={team}
                  scores={scores[team.id] || {}}
                  onScore={(categoryKey, score) => setScore(team.id, categoryKey, score)}
                />
              ))}
            </section>

            <div className="sticky bottom-0 z-10 -mx-4 border-t border-ink/15 bg-paper/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink/70">
                  {completedTeams} of {session.teams.length} teams complete
                  {status.type === "saved" ? <span className="ml-3 font-semibold text-moss">{status.text}</span> : null}
                </p>
                <div className="flex flex-wrap gap-3">
                  {session.canReport && (
                    <button className="command secondary" onClick={loadReport} disabled={reportLoading}>
                      {reportLoading ? <Loader2 className="animate-spin" size={18} /> : <BarChart3 size={18} />}
                      Report
                    </button>
                  )}
                  <button className="command" onClick={submitVotes} disabled={!canSubmit || status.type === "saving"}>
                    {status.type === "saving" ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                    Submit
                  </button>
                </div>
              </div>
            </div>

            {session.canReport && <AccessTokenTable tokens={session.accessTokens || []} />}

            {report && <ReportTable report={report} />}
          </>
        )}
      </div>
    </main>
  );
}

function TeamVote({ index, team, scores, onScore }) {
  return (
    <article className="grid gap-4 border border-ink/15 bg-white/50 p-4 shadow-line md:grid-cols-[170px_1fr] md:items-center">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">Team {String(index).padStart(2, "0")}</p>
        <h2 className="font-display text-3xl">{team.name}</h2>
        <p className="text-sm text-ink/60">{team.teamGroup}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {categories.map((category) => (
          <div key={category.key} className="rating-cell">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{category.label}</span>
              <span className="text-xs text-ink/55">{category.weight}</span>
            </div>
            <StarRating value={scores[category.key]} onChange={(score) => onScore(category.key, score)} />
          </div>
        ))}
      </div>
    </article>
  );
}

function StarRating({ value, onChange }) {
  return (
    <div className="mt-3 flex gap-1" role="radiogroup">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          className={`star-button ${score <= value ? "selected" : ""}`}
          type="button"
          aria-label={`${score} stars`}
          aria-checked={value === score}
          role="radio"
          onClick={() => onChange(score)}
        >
          <Star size={22} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

function UnsignedUser() {
  return (
    <section className="border border-ink/15 bg-white/55 p-6 shadow-line">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">Unsigned user</p>
      <h2 className="mt-2 font-display text-3xl">No voter is selected.</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/70">
        Open a voting link with an access token to load that person&apos;s ballot.
      </p>
    </section>
  );
}

function AccessTokenTable({ tokens }) {
  return (
    <section className="border-t-4 border-brass pt-5">
      <div className="mb-4 flex items-center gap-2">
        <KeyRound size={20} />
        <h2 className="font-display text-3xl">Access Tokens</h2>
      </div>
      <div className="overflow-x-auto border border-ink/15 bg-white/55">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink/15 bg-ink text-paper">
              <th className="p-3">Name</th>
              <th className="p-3">Team</th>
              <th className="p-3">Token</th>
              <th className="p-3">Link</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((row) => {
              const href = `${window.location.origin}/?token=${encodeURIComponent(row.token)}`;
              return (
                <tr key={row.token} className="border-b border-ink/10">
                  <td className="p-3 font-semibold">{row.name}</td>
                  <td className="p-3">{row.teamName}</td>
                  <td className="p-3 font-mono text-xs">{row.token}</td>
                  <td className="p-3">
                    <a className="font-mono text-xs font-bold text-ember underline" href={href}>
                      Open
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportTable({ report }) {
  return (
    <section className="border-t-4 border-ink pt-5">
      <h2 className="font-display text-3xl">Report</h2>
      <div className="mt-4 overflow-x-auto border border-ink/15 bg-white/55">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink/15 bg-ink text-paper">
              <th className="p-3">Rank</th>
              <th className="p-3">Team</th>
              {categories.map((category) => (
                <th key={category.key} className="p-3">
                  {category.label}
                </th>
              ))}
              <th className="p-3">Overall</th>
            </tr>
          </thead>
          <tbody>
            {report.map((row, index) => (
              <tr key={row.teamId} className="border-b border-ink/10">
                <td className="p-3 font-semibold">{index + 1}</td>
                <td className="p-3 font-display text-xl">{row.teamName}</td>
                <td className="p-3">{formatScore(row.category1)}</td>
                <td className="p-3">{formatScore(row.category2)}</td>
                <td className="p-3">{formatScore(row.category3)}</td>
                <td className="p-3 text-lg font-bold">{formatScore(row.overall)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Notice({ text, icon = null, tone = "neutral" }) {
  return (
    <div className={`flex items-center gap-3 border p-4 ${tone === "error" ? "border-ember/35 bg-ember/10" : "border-ink/15 bg-white/50"}`}>
      {icon}
      <p className="font-semibold">{text}</p>
    </div>
  );
}

function formatScore(score) {
  return score == null ? "Not enough votes" : Number(score).toFixed(2);
}

createRoot(document.getElementById("root")).render(<App />);
