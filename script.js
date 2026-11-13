"use strict";

const STORAGE_KEY = "ausgabenrechner_v3";
const BACKUP_PREFIX = "ausgabenrechner_v3_backup_";
const CATEGORIES = ["Lebensmittel", "Wohnen", "Mobilität", "Freizeit", "Gesundheit", "Shopping", "Sonstiges"];
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

const $ = (selector) => document.querySelector(selector);
const els = {
  form: $("#expenseForm"), description: $("#description"), amount: $("#amount"), category: $("#category"), date: $("#date"),
  month: $("#monthFilter"), total: $("#monthTotal"), count: $("#entryCount"), budget: $("#budgetDisplay"), remaining: $("#remainingBudget"),
  budgetHint: $("#budgetHint"), rows: $("#expenseRows"), empty: $("#emptyState"), table: $("#tableWrap"), chart: $("#chart"),
  formStatus: $("#formStatus"), migrationStatus: $("#migrationStatus"), budgetEditor: $("#budgetEditor"), budgetInput: $("#budgetInput"),
  budgetMonthLabel: $("#budgetMonthLabel"), dialog: $("#confirmDialog"), dialogTitle: $("#dialogTitle"), dialogText: $("#dialogText")
};

let state = loadState();

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function emptyState() { return { version: 3, expenses: [], budgets: {}, updatedAt: new Date().toISOString() }; }

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.expenses)) return normalizeState(parsed);
  } catch (error) { console.warn("Gespeicherte V3-Daten konnten nicht gelesen werden.", error); }
  return emptyState();
}

function normalizeState(value) {
  return {
    version: 3,
    expenses: (value.expenses || []).map(normalizeExpense).filter(Boolean),
    budgets: value.budgets && typeof value.budgets === "object" ? value.budgets : {},
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function normalizeExpense(item) {
  if (!item || typeof item !== "object") return null;
  const description = String(item.description ?? item.name ?? item.title ?? item.text ?? "").trim();
  const amount = Number(String(item.amount ?? item.betrag ?? item.value ?? "").replace(",", "."));
  const rawDate = item.date ?? item.datum ?? item.createdAt;
  const dateOnly = typeof rawDate === "string" ? rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0] : null;
  const date = dateOnly || (rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? localDateString(new Date(rawDate)) : null);
  if (!description || !Number.isFinite(amount) || amount <= 0 || !date) return null;
  const proposedCategory = String(item.category ?? item.kategorie ?? "Sonstiges");
  return { id: String(item.id || crypto.randomUUID()), description, amount: Math.round(amount * 100) / 100, category: CATEGORIES.includes(proposedCategory) ? proposedCategory : "Sonstiges", date };
}

function persist() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function selectedMonth() { return els.month.value; }
function expensesFor(month) { return state.expenses.filter((item) => item.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)); }
function monthTotal(month) { return expensesFor(month).reduce((sum, item) => sum + item.amount, 0); }
function parseMonth(month) { const [year, part] = month.split("-").map(Number); return new Date(year, part - 1, 1); }

function render() {
  const month = selectedMonth();
  const entries = expensesFor(month);
  const total = monthTotal(month);
  const budget = Number(state.budgets[month]);
  els.total.textContent = euro.format(total);
  els.count.textContent = `${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"}`;
  renderBudget(total, budget);
  renderRows(entries);
  renderChart(month);
}

function renderBudget(total, budget) {
  if (Number.isFinite(budget) && budget >= 0) {
    const remaining = budget - total;
    els.budget.textContent = euro.format(budget);
    els.remaining.textContent = euro.format(remaining);
    els.remaining.style.color = remaining < 0 ? "var(--red)" : "var(--ink)";
    els.budgetHint.textContent = remaining < 0 ? "Budget überschritten" : `${Math.round(budget ? (total / budget) * 100 : 0)} % genutzt`;
    $("#editBudget").textContent = "Budget ändern";
  } else {
    els.budget.textContent = "Nicht gesetzt"; els.remaining.textContent = "—"; els.remaining.style.color = "";
    els.budgetHint.textContent = "Lege zuerst ein Budget fest"; $("#editBudget").textContent = "Budget festlegen";
  }
}

function renderRows(entries) {
  els.rows.replaceChildren();
  els.empty.hidden = entries.length > 0;
  els.table.hidden = entries.length === 0;
  entries.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${escapeHtml(dateFormatter.format(new Date(`${item.date}T12:00:00`)))}</td><td>${escapeHtml(item.description)}</td><td><span class="category-badge">${escapeHtml(item.category)}</span></td><td class="number">${escapeHtml(euro.format(item.amount))}</td><td><button class="delete-row" type="button" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.description)} löschen">✕</button></td>`;
    els.rows.append(row);
  });
}

function renderChart(endMonth) {
  const end = parseMonth(endMonth);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(end.getFullYear(), end.getMonth() - (5 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, date, total: monthTotal(key) };
  });
  const max = Math.max(...months.map((item) => item.total), 1);
  els.chart.replaceChildren();
  months.forEach((item) => {
    const wrapper = document.createElement("div"); wrapper.className = "bar-item";
    const height = Math.max((item.total / max) * 145, item.total ? 5 : 2);
    wrapper.innerHTML = `<span class="bar-value">${escapeHtml(compactEuro(item.total))}</span><div class="bar ${item.key === endMonth ? "current" : ""}" style="height:${height}px" title="${escapeHtml(monthFormatter.format(item.date))}: ${escapeHtml(euro.format(item.total))}"></div><span class="bar-label">${escapeHtml(item.date.toLocaleDateString("de-DE", { month: "short" }))}</span>`;
    els.chart.append(wrapper);
  });
  els.chart.setAttribute("aria-label", months.map((item) => `${monthFormatter.format(item.date)}: ${euro.format(item.total)}`).join(", "));
}

function compactEuro(value) { return value >= 1000 ? `${(value / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tsd. €` : euro.format(value); }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
function announce(message) { els.formStatus.textContent = message; window.setTimeout(() => { if (els.formStatus.textContent === message) els.formStatus.textContent = ""; }, 3000); }

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const expense = normalizeExpense({ description: els.description.value, amount: els.amount.value, category: els.category.value, date: els.date.value });
  if (!expense) return announce("Bitte prüfe deine Eingaben.");
  state.expenses.push(expense); persist(); els.form.reset(); els.date.value = localDateString(); els.category.value = "Lebensmittel";
  els.month.value = expense.date.slice(0, 7); render(); announce("Ausgabe wurde gespeichert."); els.description.focus();
});

els.month.addEventListener("change", render);
els.rows.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]"); if (!button) return;
  const item = state.expenses.find((entry) => entry.id === button.dataset.id);
  if (item && await confirmAction("Ausgabe löschen?", `„${item.description}“ (${euro.format(item.amount)}) wird dauerhaft gelöscht.`)) {
    state.expenses = state.expenses.filter((entry) => entry.id !== item.id); persist(); render();
  }
});

$("#editBudget").addEventListener("click", () => {
  const month = selectedMonth(); els.budgetMonthLabel.textContent = monthFormatter.format(parseMonth(month));
  els.budgetInput.value = state.budgets[month] ?? ""; els.budgetEditor.hidden = false; els.budgetInput.focus();
});
$("#cancelBudget").addEventListener("click", () => { els.budgetEditor.hidden = true; });
$("#saveBudget").addEventListener("click", () => {
  const value = Number(els.budgetInput.value);
  if (!Number.isFinite(value) || value < 0) return announce("Bitte gib ein gültiges Budget ein.");
  state.budgets[selectedMonth()] = Math.round(value * 100) / 100; persist(); els.budgetEditor.hidden = true; render(); announce("Budget wurde gespeichert.");
});

$("#deleteMonth").addEventListener("click", async () => {
  const month = selectedMonth(); const entries = expensesFor(month);
  if (!entries.length) return announce("In diesem Monat gibt es nichts zu löschen.");
  if (await confirmAction("Ganzen Monat löschen?", `${entries.length} Einträge aus ${monthFormatter.format(parseMonth(month))} werden dauerhaft gelöscht.`)) {
    state.expenses = state.expenses.filter((item) => !item.date.startsWith(month)); persist(); render(); announce("Monat wurde gelöscht.");
  }
});

$("#exportCsv").addEventListener("click", () => {
  const entries = expensesFor(selectedMonth());
  if (!entries.length) return announce("Für diesen Monat sind keine Daten vorhanden.");
  const lines = [["Datum", "Beschreibung", "Kategorie", "Betrag (EUR)"], ...entries.map((item) => [item.date, item.description, item.category, item.amount.toFixed(2).replace(".", ",")])];
  const csv = "\uFEFF" + lines.map((row) => row.map(csvCell).join(";")).join("\r\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `ausgaben-${selectedMonth()}.csv`);
});

function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function download(blob, filename) { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function backup(filename = `ausgabenrechner-sicherung-${localDateString()}.json`) { download(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), filename); }

$("#backupData").addEventListener("click", () => backup());
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : parsed.expenses;
    if (!Array.isArray(source)) throw new Error("Keine Ausgabenliste gefunden");
    const imported = source.map(normalizeExpense).filter(Boolean);
    if (!imported.length && source.length) throw new Error("Das Format wird nicht erkannt");
    saveInternalBackup();
    mergeExpenses(imported);
    if (parsed.budgets && typeof parsed.budgets === "object") state.budgets = { ...parsed.budgets, ...state.budgets };
    persist(); render(); els.migrationStatus.textContent = `${imported.length} Einträge importiert. Eine interne Sicherung wurde angelegt.`;
  } catch (error) { els.migrationStatus.textContent = `Import nicht möglich: ${error.message}`; }
  event.target.value = "";
});

$("#scanLegacy").addEventListener("click", async () => {
  const candidates = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index); if (!key || key === STORAGE_KEY || key.startsWith(BACKUP_PREFIX)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key));
      const list = Array.isArray(value) ? value : value?.expenses ?? value?.ausgaben;
      if (!Array.isArray(list) || !list.length) continue;
      const normalized = list.map(normalizeExpense).filter(Boolean);
      if (normalized.length && normalized.length / list.length >= 0.6) candidates.push({ key, expenses: normalized });
    } catch (_) { /* Kein passendes JSON – bewusst überspringen. */ }
  }
  if (!candidates.length) { els.migrationStatus.textContent = "Keine eindeutig erkennbaren Altdaten gefunden. Nutze bei Bedarf den JSON-Import oder nenne den bisherigen Storage-Key."; return; }
  const total = candidates.reduce((sum, item) => sum + item.expenses.length, 0);
  const keys = candidates.map((item) => `„${item.key}“`).join(", ");
  if (await confirmAction("Altdaten übernehmen?", `${total} plausible Einträge aus ${keys} wurden gefunden. Die Originaldaten bleiben unverändert; zusätzlich wird eine Sicherung angelegt.`)) {
    saveInternalBackup(); candidates.forEach((candidate) => mergeExpenses(candidate.expenses)); persist(); render();
    els.migrationStatus.textContent = `${total} Einträge geprüft und übernommen. Original und Sicherung bleiben gespeichert.`;
  }
});

function mergeExpenses(imported) {
  const fingerprints = new Set(state.expenses.map(fingerprint));
  imported.forEach((item) => { const mark = fingerprint(item); if (!fingerprints.has(mark)) { state.expenses.push(item); fingerprints.add(mark); } });
}
function fingerprint(item) { return `${item.date}|${item.description.toLowerCase()}|${item.amount.toFixed(2)}|${item.category}`; }
function saveInternalBackup() { localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}`, JSON.stringify(state)); }
function confirmAction(title, text) {
  if (typeof els.dialog.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  els.dialogTitle.textContent = title; els.dialogText.textContent = text; els.dialog.showModal();
  return new Promise((resolve) => els.dialog.addEventListener("close", () => resolve(els.dialog.returnValue === "confirm"), { once: true }));
}

$("#themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; localStorage.setItem("ausgabenrechner_theme", next);
});

function initialize() {
  const today = localDateString(); els.date.value = today; els.month.value = today.slice(0, 7);
  const theme = localStorage.getItem("ausgabenrechner_theme"); if (theme) document.documentElement.dataset.theme = theme;
  render();
}

initialize();
