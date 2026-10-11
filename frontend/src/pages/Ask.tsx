import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, SquarePen } from "lucide-react";
import { api } from "../lib/api";
import { useMeta } from "../lib/hooks";
import { cn } from "../lib/format";
import { Card, IconButton, PageHeader, Textarea } from "../components/ui";

type Msg = { role: "user" | "assistant"; content: string };
const PROVIDER: Record<string, string> = { gemini: "Google Gemini", groq: "Groq", custom: "your AI provider" };
const QUICK = ["Give me a short summary of my portfolio this week.", "Which holdings give me the most dividends?", "How is my money split by currency?"];

let kept: Msg[] = []; // the conversation survives switching tabs, not a reload

export function Ask() {
  const meta = useMeta();
  const providers = meta.data?.ai_providers ?? [];
  const [msgs, setMsgsState] = useState<Msg[]>(kept);
  const setMsgs = (m: Msg[]) => {
    kept = m;
    setMsgsState(m);
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs, busy]);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setText("");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ answer: string }>("/ai/ask", { body: { messages: next } });
      setMsgs([...next, { role: "assistant", content: r.answer || "(no answer)" }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const who = providers.map((p) => PROVIDER[p] ?? p).join(" or ");
  return (
    <div className="space-y-4">
      <PageHeader title="AI assistant">
        {msgs.length > 0 && (
          <IconButton label="New chat" onClick={() => setMsgs([])}>
            <SquarePen className="h-[21px] w-[21px]" strokeWidth={2} />
          </IconButton>
        )}
      </PageHeader>
      {!providers.length ? (
        <Card className="p-4 text-[15px] text-muted">
          No AI provider is set up. Add GEMINI_API_KEY or GROQ_API_KEY to the .env file on your PC (both are free) and restart the app.
        </Card>
      ) : (
        <>
          {msgs.length === 0 && (
            <section>
              <p className="px-1 pb-3 text-[15px] text-muted">Ask about your own holdings: what you own, where your money is, dividends and what is coming up.</p>
              <Card>
                <ul>
                  {QUICK.map((q, i) => (
                    <li key={q}>
                      <button type="button" onClick={() => send(q)} className="flex w-full items-center pl-4 text-left active:bg-fill/[0.08]">
                        <span className={cn("flex flex-1 items-center gap-2 py-3 pr-3 text-[17px] text-accent", i < QUICK.length - 1 && "hairline")}>
                          <span className="flex-1">{q}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          <div className="space-y-2">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} data-role="user" className="ml-12 flex justify-end">
                  <p className="rounded-[18px] bg-accent px-3.5 py-2 text-[17px] leading-snug text-white">{m.content}</p>
                </div>
              ) : (
                <div key={i} data-role="assistant" className="mr-6 break-words rounded-[18px] bg-surface px-3.5 py-2.5 text-[17px] leading-snug text-fg">
                  <Answer text={m.content} />
                </div>
              ),
            )}
            {busy && (
              <div className="inline-flex gap-1 rounded-[18px] bg-surface px-4 py-3" aria-label="Thinking">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-2 w-2 animate-pulse rounded-full bg-faint" style={{ animationDelay: `${d * 0.2}s` }} />
                ))}
              </div>
            )}
            {err && (
              <p role="alert" className="px-1 text-[15px] text-down">
                {err}
              </p>
            )}
          </div>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Textarea
              aria-label="Your question"
              placeholder="Ask about your portfolio"
              rows={1}
              className="block min-h-[44px] resize-none rounded-[22px] border-[0.5px] border-line bg-surface py-[10px] pl-4 pr-12 leading-6"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || busy}
              className="absolute right-[6px] top-1/2 flex h-[30px] -translate-y-1/2 w-[30px] items-center justify-center rounded-full bg-accent text-white disabled:opacity-30"
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.75} />
            </button>
          </form>
          <div ref={end} />
          <p className="px-1 text-[13px] leading-relaxed text-muted">
            Your holdings (symbols, amounts, brokers) are sent to {who} to answer. Free tiers may use what you send to improve their models. Answers can be wrong and are not financial advice.
          </p>
        </>
      )}
    </div>
  );
}

/** Light formatting for model answers: "- " lines become a list, **bold** is kept. */
function Answer({ text }: { text: string }) {
  const blocks: ({ list: string[] } | { p: string })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const b = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (b) {
      if (last && "list" in last) last.list.push(b[1]);
      else blocks.push({ list: [b[1]] });
    } else blocks.push({ p: line });
  }
  const inline = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part));
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        "list" in b ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-faint">
            {b.list.map((li, j) => (
              <li key={j}>{inline(li)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.p)}</p>
        ),
      )}
    </div>
  );
}
