import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, SquarePen } from "lucide-react";
import { api } from "../lib/api";
import { useMeta } from "../lib/hooks";
import { Card, IconButton, PageHeader } from "../components/ui";

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
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (msgs.length) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs, busy]);
  useEffect(() => {
    // grow the composer with its text, up to about six lines
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

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
  if (!providers.length)
    return (
      <div className="space-y-4">
        <PageHeader title="AI Assistant" />
        <Card className="p-4 text-[15px] text-muted">
          No AI provider is set up. Add GEMINI_API_KEY or GROQ_API_KEY to the .env file on your PC (both are free) and restart the app.
        </Card>
      </div>
    );

  return (
    <div>
      <PageHeader title="AI Assistant">
        {msgs.length > 0 && (
          <IconButton label="New chat" onClick={() => setMsgs([])}>
            <SquarePen className="h-[21px] w-[21px]" strokeWidth={2} />
          </IconButton>
        )}
      </PageHeader>

      {msgs.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-330px)] flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-fg">How can I help?</p>
          <p className="mt-1.5 max-w-xs text-[15px] text-muted">Ask about your holdings, where your money is, dividends or what is coming up.</p>
          <p className="mt-4 max-w-xs text-[12px] leading-relaxed text-faint">
            Your holdings (symbols, amounts, brokers) are sent to {who} to answer. Free tiers may use what you send to improve their models.
          </p>
        </div>
      ) : (
        <div className="space-y-6 pb-4 pt-4">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} data-role="user" className="flex justify-end pl-12">
                <p className="whitespace-pre-wrap rounded-[20px] bg-fill/[0.14] px-4 py-2.5 text-[16px] leading-snug text-fg">{m.content}</p>
              </div>
            ) : (
              <div key={i} data-role="assistant" className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 break-words text-[16px] leading-relaxed text-fg">
                  <Answer text={m.content} />
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-3" aria-label="Thinking">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Sparkles className="h-4 w-4 animate-pulse" />
              </div>
              <span className="text-[15px] text-muted">Thinking…</span>
            </div>
          )}
          {err && (
            <p role="alert" className="rounded-[12px] bg-down-soft px-3.5 py-2.5 text-[15px] text-down">
              {err}
            </p>
          )}
        </div>
      )}
      <div ref={end} className="h-44" aria-hidden />

      {/* Composer pinned above the tab bar, like ChatGPT / Claude */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+52px)] z-30 bg-gradient-to-t from-page via-page/95 to-transparent pt-6">
        <div className="mx-auto max-w-[640px] px-4 pb-2">
          {msgs.length === 0 && (
            <div className="no-scrollbar -mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="w-[200px] shrink-0 rounded-[16px] border-[0.5px] border-line bg-surface px-3.5 py-2.5 text-left text-[14px] leading-snug text-fg active:opacity-70">
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2 rounded-[26px] border-[0.5px] border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <textarea
              ref={box}
              aria-label="Your question"
              placeholder="Message AI Assistant"
              rows={1}
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-[7px] text-[16px] leading-[22px] text-fg placeholder:text-faint focus:outline-none"
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
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-page transition-opacity disabled:opacity-20"
            >
              <ArrowUp className="h-[19px] w-[19px]" strokeWidth={2.5} />
            </button>
          </form>
          <p className="pt-1.5 text-center text-[11px] text-faint">AI can make mistakes. Not financial advice.</p>
        </div>
      </div>
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
