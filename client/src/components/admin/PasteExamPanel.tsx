import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { parseExamSets, type ParsedExamSet } from "../../lib/examPaperParser";

// "Paste an exam": the central admin pastes a book's exam as he wrote it (the
// question paper and the teacher's answer key, one or several sets, English or
// French), sees how it was read (every question with its right answer, the
// personal questions with what each choice counts as), and saves it only then.

const BLOCKING = /^(KEY_DIFFERS|NO_ANSWER|NO_KEY|OPTIONS)/;

export function PasteExamPanel({
  bookId,
  onSaved,
}: {
  bookId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<"EN" | "FR">("EN");
  const [text, setText] = useState("");
  const [sets, setSets] = useState<ParsedExamSet[] | null>(null);
  // Personal questions that do not decide whether someone is "born again" (Bible reading, availability...), by "set:code".
  const [notStatus, setNotStatus] = useState<Record<string, boolean>>({});
  // The personal questions are the same in every set: the first set's are used for all of them.
  const [sameSection, setSameSection] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    saved: number[];
    skipped: number[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  function read() {
    setResult(null);
    setError(null);
    const parsed = parseExamSets(text, { language });
    if (parsed.length === 0 || parsed.every((s) => s.questions.length === 0)) {
      setSets(null);
      return setError(t("library.exam_none"));
    }
    setSets(parsed);
    setNotStatus({});
  }

  const blocked =
    sets?.some((s) => s.warnings.some((w) => BLOCKING.test(w))) ?? false;
  const shared = sameSection && (sets?.length ?? 0) > 1;

  async function save() {
    if (!sets || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ saved: number[]; skipped: number[] }>(
        `/api/admin/library/books/${bookId}/exam-import`,
        {
          language,
          samePersonal: sameSection,
          sets: sets.map((s) => {
            const source = shared ? sets[0] : s;
            return {
              setNumber: s.setNumber,
              questions: s.questions.map((q) => ({
                text: q.text,
                options: q.options.map((o, i) => ({
                  text: o,
                  isCorrect: i === q.correct,
                })),
              })),
              personal: source.personal.map((p) => ({
                kind: p.kind,
                text: p.text,
                body: p.body,
                guide: p.guide,
                required: p.required,
                flagUnlessNone: p.flagUnlessNone,
                affectsStatus:
                  p.affectsStatus &&
                  !notStatus[`${source.setNumber}:${p.code}`],
                options: p.options,
              })),
            };
          }),
        },
      );
      setResult(r);
      setSets(null);
      setText("");
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("library.action_failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  function warningText(w: string): string {
    const [kind, n] = w.split(":");
    switch (kind) {
      case "KEY_DIFFERS":
        return t("library.exam_warn_key_differs", { n }) ?? "";
      case "NO_ANSWER":
        return t("library.exam_warn_no_answer", { n }) ?? "";
      case "NO_KEY":
        return t("library.exam_warn_no_key") ?? "";
      case "OPTIONS":
        return t("library.exam_warn_options", { n }) ?? "";
      default:
        return t("library.exam_warn_no_guide") ?? "";
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-secondary w-full px-3 py-2 text-sm"
        onClick={() => setOpen(true)}
      >
        📝 {t("library.exam_toggle")}
      </button>
    );
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
      data-testid="paste-exam"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          📝 {t("library.exam_toggle")}
        </p>
        <button
          type="button"
          className="text-sm text-slate-500 underline"
          onClick={() => setOpen(false)}
        >
          {t("library.paste_close")}
        </button>
      </div>
      <p className="text-xs text-slate-600">{t("library.exam_help")}</p>
      <label className="block text-sm">
        <span className="mr-2 font-medium text-slate-700">
          {t("library.paste_language")}
        </span>
        <select
          className="input inline-block w-auto"
          value={language}
          onChange={(e) => setLanguage(e.target.value as "EN" | "FR")}
          aria-label={t("library.paste_language") ?? ""}
        >
          <option value="EN">{t("library.paste_language_en")}</option>
          <option value="FR">{t("library.paste_language_fr")}</option>
        </select>
      </label>
      {language === "FR" && (
        <p className="text-xs text-amber-800">{t("library.exam_fr_note")}</p>
      )}
      <textarea
        className="input"
        rows={10}
        aria-label={t("library.exam_box") ?? ""}
        placeholder={t("library.exam_placeholder") ?? ""}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary px-3 py-1 text-sm"
        disabled={!text.trim()}
        onClick={read}
      >
        {t("library.exam_read")}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {result && (
        <p className="text-sm text-green-700" data-testid="exam-saved">
          {t("library.exam_saved", { sets: result.saved.join(", ") || "—" })}
          {result.skipped.length > 0 && (
            <span className="block text-amber-800">
              {t("library.exam_skipped", { sets: result.skipped.join(", ") })}
            </span>
          )}
        </p>
      )}
      {sets && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            {t("library.exam_found", { count: sets.length })}
          </p>
          {
            <label className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={sameSection}
                onChange={(e) => setSameSection(e.target.checked)}
              />
              <span>
                <span className="block font-semibold text-slate-800">
                  {t("library.exam_same_section")}
                </span>
                <span className="block text-xs text-slate-500">
                  {t("library.exam_same_section_help", {
                    number: sets[0].setNumber,
                  })}
                </span>
              </span>
            </label>
          }
          {sets.map((s) => {
            const choice = s.questions.filter(
              (q) => q.kind === "CHOICE",
            ).length;
            return (
              <section
                key={s.setNumber}
                className="rounded-lg border border-slate-200 bg-white p-3"
                data-testid="exam-set-preview"
              >
                <h4 className="font-semibold text-brand-900">
                  {t("library.exam_set_line", {
                    number: s.setNumber,
                    total: s.questions.length,
                    choice,
                    tf: s.questions.length - choice,
                    personal: s.personal.length,
                  })}
                </h4>
                {s.warnings.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                    {s.warnings.map((w) => (
                      <li
                        key={w}
                        className={
                          BLOCKING.test(w) ? "font-semibold text-red-700" : ""
                        }
                      >
                        {warningText(w)}
                      </li>
                    ))}
                  </ul>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-brand-700">
                    {t("library.exam_show_questions")}
                  </summary>
                  <ol className="mt-2 space-y-2 text-sm">
                    {s.questions.map((q) => (
                      <li key={q.number}>
                        <p className="font-medium text-slate-800">
                          {q.number}. {q.text}
                        </p>
                        <ul className="ml-4 list-disc text-xs">
                          {q.options.map((o, i) => (
                            <li
                              key={i}
                              className={
                                i === q.correct
                                  ? "font-semibold text-green-700"
                                  : "text-slate-600"
                              }
                            >
                              {i === q.correct ? "✓ " : ""}
                              {o}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </details>
                {shared && s.setNumber !== sets[0].setNumber && (
                  <p className="mt-2 text-xs text-slate-500">
                    {t("library.exam_same_as", { number: sets[0].setNumber })}
                  </p>
                )}
                {s.personal.length > 0 &&
                  !(shared && s.setNumber !== sets[0].setNumber) && (
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-sm text-brand-700">
                        {t("library.exam_personal", {
                          count: s.personal.length,
                        })}
                      </summary>
                      <ol className="mt-2 space-y-2 text-sm">
                        {s.personal.map((p) => (
                          <li key={p.code}>
                            <p className="font-medium text-slate-800">
                              {p.code}. {p.text}
                              {!p.required && (
                                <span className="ml-2 text-xs font-normal text-slate-500">
                                  ({t("admin.assessments.personal_optional")})
                                </span>
                              )}
                            </p>
                            {p.kind === "TEXT" ? (
                              <p className="text-xs text-slate-600">
                                {p.flagUnlessNone
                                  ? t("admin.assessments.personal_typed_flag")
                                  : t("admin.assessments.personal_typed")}
                              </p>
                            ) : (
                              <ul className="ml-4 list-disc text-xs">
                                {p.options.map((o, i) => (
                                  <li
                                    key={i}
                                    className={
                                      o.signal === "POSITIVE"
                                        ? "font-semibold text-green-700"
                                        : "text-slate-600"
                                    }
                                  >
                                    {o.signal === "POSITIVE" ? "✓ " : "⚑ "}
                                    {o.text}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {p.guide && (
                              <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                {p.guide}
                              </p>
                            )}
                            {p.required && p.affectsStatus && (
                              <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={Boolean(
                                    notStatus[`${s.setNumber}:${p.code}`],
                                  )}
                                  onChange={(e) =>
                                    setNotStatus((n) => ({
                                      ...n,
                                      [`${s.setNumber}:${p.code}`]:
                                        e.target.checked,
                                    }))
                                  }
                                />
                                {t("library.exam_not_status")}
                              </label>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
              </section>
            );
          })}
          <p className="text-xs text-slate-500">
            {t("library.exam_signals_help")}
          </p>
          <button
            type="button"
            className="btn-primary px-3 py-1 text-sm"
            disabled={busy || blocked}
            onClick={save}
          >
            {t("library.exam_save")}
          </button>
          {blocked && (
            <p className="text-xs text-red-700">{t("library.exam_blocked")}</p>
          )}
        </div>
      )}
    </div>
  );
}
