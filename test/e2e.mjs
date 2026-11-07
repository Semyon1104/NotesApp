import fs from "node:fs";
import http from "node:http";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}
const pageList = await getJson("http://127.0.0.1:9333/json");
const page = pageList.find((item) => item.url.includes("polia.local"));
if (!page) throw new Error("WebView2 page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const task = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) task.reject(new Error(message.error.message));
  else task.resolve(message.result);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return true;
    await wait(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function waitForFileText(file, text, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text)) return true;
    await wait(100);
  }
  throw new Error(`Timed out waiting for text in ${file}: ${text}`);
}
async function waitForFilePattern(file, pattern, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file) && pattern.test(fs.readFileSync(file, "utf8"))) return true;
    await wait(100);
  }
  throw new Error(`Timed out waiting for pattern in ${file}: ${pattern}`);
}
async function waitForJsonFile(file, predicate, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (predicate(data)) return data;
    } catch (_) {}
    await wait(100);
  }
  throw new Error(`Timed out waiting for JSON condition in ${file}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function click(selector) {
  const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert(clicked, `Element not found: ${selector}`);
  await wait(120);
}
async function createCategory(name) {
  const before = await evaluate("document.querySelectorAll('.category-chip').length");
  await click("#newCategoryButton");
  await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
  await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = ${JSON.stringify(name)}; return true; })()`);
  await click("#dialogConfirm");
  await waitFor(`document.querySelectorAll('.category-chip').length === ${before + 1}`);
}
async function assignCategoryToCard(categoryName, cardTitle, kind = null) {
  const cardSelector = kind === "note" ? ".note-card" : kind === "folder" ? ".folder-card" : ".card";
  const assigned = await evaluate(`(() => {
    const chip = Array.from(document.querySelectorAll('.category-chip')).find((item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(categoryName)});
    const card = Array.from(document.querySelectorAll(${JSON.stringify(cardSelector)})).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(cardTitle)});
    if (!chip || !card) return false;
    const transfer = new DataTransfer();
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = card.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    card.dispatchEvent(new DragEvent('dragover', init));
    card.dispatchEvent(new DragEvent('drop', init));
    chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  assert(assigned, `Category drag should find ${categoryName} and ${cardTitle}`);
  await waitFor(`(() => {
    const card = Array.from(document.querySelectorAll(${JSON.stringify(cardSelector)})).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(cardTitle)});
    return card?.querySelector('.note-category')?.textContent === ${JSON.stringify(categoryName)};
  })()`);
  await wait(600);
}

async function assignCategoryToNote(categoryName, noteTitle) {
  await assignCategoryToCard(categoryName, noteTitle, "note");
}

async function assignCategoryToFolder(categoryName, folderTitle) {
  await assignCategoryToCard(categoryName, folderTitle, "folder");
}

async function createSubcategory(groupName, subcategoryName) {
  const clicked = await evaluate(`(() => {
    const group = Array.from(document.querySelectorAll('.category-group')).find((item) => item.querySelector('.category-chip .category-name')?.textContent === ${JSON.stringify(groupName)});
    const button = group?.querySelector('[data-add-subcategory]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Subcategory add button not found for ${groupName}`);
  await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
  await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = ${JSON.stringify(subcategoryName)}; return true; })()`);
  await click("#dialogConfirm");
  await waitFor(`Array.from(document.querySelectorAll('.category-subchip .category-name')).some((node) => node.textContent === ${JSON.stringify(subcategoryName)})`);
}

async function assignSubcategoryToNote(subcategoryName, noteTitle) {
  const assigned = await evaluate(`(() => {
    const chip = Array.from(document.querySelectorAll('.category-subchip')).find((item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(subcategoryName)});
    const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(noteTitle)});
    if (!chip || !card) return false;
    const transfer = new DataTransfer();
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = card.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    card.dispatchEvent(new DragEvent('dragover', init));
    card.dispatchEvent(new DragEvent('drop', init));
    chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  assert(assigned, `Subcategory drag should find ${subcategoryName} and ${noteTitle}`);
  await waitFor(`(() => {
    const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(noteTitle)});
    return Array.from(card?.querySelectorAll('.note-category') || []).some((node) => node.textContent === ${JSON.stringify(subcategoryName)});
  })()`);
  await wait(350);
}

async function createTestNote(title) {
  await click("#newNoteButton");
  await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
  await waitFor("document.activeElement && document.activeElement.id === 'noteTitleInput'");
  await evaluate(`(() => { const input = document.querySelector('#noteTitleInput'); input.value = ${JSON.stringify(title)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await wait(450);
  await click("#closeNoteButton");
  await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(title)})`);
}


async function removeCategory(name) {
  const clicked = await evaluate(`(() => {
    const chip = Array.from(document.querySelectorAll('.category-chip, .category-subchip')).find(
      (item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(name)}
    );
    const button = chip?.querySelector('[data-remove-category]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Remove button not found for ${name}`);
  await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
  await click("#dialogConfirm");
  await waitFor(`!Array.from(document.querySelectorAll('.category-chip, .category-subchip')).some(
    (item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(name)}
  )`);
  await wait(400);
}

async function renameCategoryChip(name, newName, selector = '.category-chip, .category-subchip') {
  const clicked = await evaluate(`(() => {
    const chip = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(
      (item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(name)}
    );
    const button = chip?.querySelector('[data-rename-category]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Rename button not found for ${name}`);
  await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
  const currentName = await evaluate("document.querySelector('#dialogInput').value");
  assert(currentName === name, `Rename dialog should be prefilled with ${name}`);
  await evaluate(`(() => { document.querySelector('#dialogInput').value = ${JSON.stringify(newName)}; return true; })()`);
  await click("#dialogConfirm");
  await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(
    (item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(newName)}
  )`);
  await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) =>
    (state.Categories || []).some((category) => category.Name === newName)
  );
  await wait(300);
}

await send("Runtime.enable");
await send("Page.enable");
await waitFor("document.readyState === 'complete'");
await waitFor("document.querySelector('#loadingScreen').classList.contains('hide')", 10000);
console.log("bootstrap: ok", await evaluate("document.title"));

const branding = await evaluate(`({
  brand: document.querySelector('.brand-name')?.innerText || '',
  shortcuts: document.querySelector('.shortcut-panel')?.textContent || '',
  bodyText: document.body.innerText.toLowerCase(),
  bodyHtml: document.body.innerHTML
})`);
assert(branding.brand.replace(/\s+/g, "") === "Pisa-nina", "Brand should be Pisa-nina on two lines");
for (const forbidden of ["ваше пространство", "главная", "хранится", "чистый лист", "ctrl+v", "ctrl + v"]) {
  assert(!branding.bodyText.includes(forbidden), `Visible hint should be removed: ${forbidden}`);
}
assert(!/ctrl\s*\+\s*v/i.test(branding.bodyHtml), "Ctrl+V hint should be removed from the UI");
assert(branding.shortcuts.includes("Горячие клавиши") && branding.shortcuts.includes("Ctrl"), "Sidebar should show keyboard shortcuts");
console.log("brand and hints: ok");

const sidebarToggleOpen = await evaluate(`(() => {
  const button = document.querySelector('#sidebarToggle');
  const root = document.querySelector('#rootButton');
  const show = document.querySelector('#sidebarShowButton');
  const rect = button.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    title: button.title,
    inSidebar: Boolean(button.closest('.sidebar')),
    beforeHome: Boolean(button.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING),
    leftOfHome: rect.right <= rootRect.left + 1,
    showHidden: getComputedStyle(show).display === 'none'
  };
})()`);
assert(sidebarToggleOpen.title === "Скрыть панель", "Sidebar toggle should offer to hide the sidebar");
assert(sidebarToggleOpen.inSidebar && sidebarToggleOpen.beforeHome && sidebarToggleOpen.leftOfHome, "Hide-sidebar button should sit at the left edge before the home button");
assert(sidebarToggleOpen.showHidden, "Show-sidebar button should be hidden while the sidebar is open");
await click("#sidebarToggle");
await waitFor("document.querySelector('.app-shell').classList.contains('sidebar-collapsed')");
const sidebarToggleCollapsed = await evaluate(`(() => {
  const show = document.querySelector('#sidebarShowButton');
  const breadcrumbs = document.querySelector('#breadcrumbs');
  const rect = show.getBoundingClientRect();
  return {
    visible: getComputedStyle(show).display !== 'none',
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    title: show.title,
    leftOfBreadcrumbs: rect.left < breadcrumbs.getBoundingClientRect().left
  };
})()`);
assert(sidebarToggleCollapsed.visible && sidebarToggleCollapsed.leftOfBreadcrumbs, "Show-sidebar button should appear at the left edge of the toolbar");
assert(sidebarToggleCollapsed.title === "Показать панель", "Show-sidebar button should offer to show the sidebar");
await click("#sidebarShowButton");
await waitFor("!document.querySelector('.app-shell').classList.contains('sidebar-collapsed')");
await wait(300);
const sidebarToggleRestored = await evaluate(`(() => {
  const button = document.querySelector('#sidebarToggle');
  const rect = button.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, title: button.title };
})()`);
assert(sidebarToggleRestored.title === "Скрыть панель", "Sidebar toggle should offer to hide the sidebar again");
for (const key of ["left", "top", "width", "height"]) {
  assert(Math.abs(sidebarToggleRestored[key] - sidebarToggleOpen[key]) < 1, `Sidebar toggle should return to the same ${key} position`);
}
console.log("sidebar toggle: ok");

const initial = await evaluate(`({ cards: document.querySelectorAll('.card').length, empty: !document.querySelector('#emptyState').hidden })`);
console.log("initial:", JSON.stringify(initial));

const testTitle = `Тест ${Date.now()}`;
const testSubtitle = `Подзаголовок ${Date.now()}`;
await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'т', code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })); true");
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
assert(await evaluate("!document.querySelector('#noteEditorWrap').hidden"), "Editor should open");
await waitFor("document.activeElement && document.activeElement.id === 'noteTitleInput'");
const titleOnCreate = await evaluate(`(() => {
  const title = document.querySelector('#noteTitleInput');
  return { value: title.value, start: title.selectionStart, end: title.selectionEnd };
})()`);
assert(titleOnCreate.value === "Новая заметка", "New note title should be preset");
assert(titleOnCreate.start === 0 && titleOnCreate.end === titleOnCreate.value.length, "New note title should be selected");
await evaluate(`(() => {
  const title = document.querySelector('#noteTitleInput');
  title.value = ${JSON.stringify(testTitle)};
  title.dispatchEvent(new Event('input', { bubbles: true }));
  const subtitle = document.querySelector('#noteSubtitleInput');
  subtitle.value = ${JSON.stringify(testSubtitle)};
  subtitle.dispatchEvent(new Event('input', { bubbles: true }));
  const editor = document.querySelector('#noteEditor');
  editor.innerHTML = '<p>Первая строка</p><p><strong>Важно</strong> сохранить это.</p>';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const numberedListButton = await evaluate(`(() => {
  const button = document.querySelector('[data-command="insertOrderedList"]');
  return button ? { icon: button.querySelector('use')?.getAttribute('href') || '', title: button.title } : null;
})()`);
assert(numberedListButton?.icon === '#i-number-list', "Numbered-list button should be present in the format bar");
assert(numberedListButton.title === "Нумерованный список", "Numbered-list button should have a clear tooltip");
await evaluate(`(() => {
  const editor = document.querySelector('#noteEditor');
  const target = editor.lastElementChild || editor;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
  return true;
})()`);
await click('[data-command="insertOrderedList"]');
await waitFor("Boolean(document.querySelector('#noteEditor ol li'))");
await wait(600);
assert(fs.existsSync("C:/sema/NotesApp/.test-data/notes.json"), "notes.json should be created");
const beforeManualSave = fs.readFileSync("C:/sema/NotesApp/.test-data/notes.json", "utf8");
assert(!beforeManualSave.includes(testTitle), "Typing should not auto-save the note");
const saveUi = await evaluate(`(() => {
  const button = document.querySelector('#saveNoteButton');
  return { disabled: button.disabled, dirty: button.classList.contains('dirty') };
})()`);
assert(!saveUi.disabled && saveUi.dirty, "Save button should be enabled and marked dirty");
await click("#saveNoteButton");
await waitForFileText("C:/sema/NotesApp/.test-data/notes.json", testTitle);
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Notes || []).some((note) => note.Title === testTitle && note.Subtitle === testSubtitle));
const subtitleAfterSave = await evaluate(`(() => ({
  editor: document.querySelector('#noteSubtitleInput').value,
  view: document.querySelector('#noteViewSubtitle').textContent,
  hidden: document.querySelector('#noteViewSubtitle').hidden
}))()`);
assert(subtitleAfterSave.editor === testSubtitle, "Subtitle input should keep the entered value");
assert(subtitleAfterSave.view === testSubtitle && !subtitleAfterSave.hidden, "Saved subtitle should appear under the note title");
console.log("note subtitle: ok");
console.log("manual save button: ok");

await wait(350);
assert(!(await evaluate("document.querySelector('#noteEditorWrap').hidden")), "Note should stay directly editable after saving");
assert(await evaluate("document.querySelector('#noteTitleInput').value.includes('Тест')"), "Editable title should contain the note title");
await click("#closeNoteButton");
await waitFor("!document.querySelector('#noteOverlay').classList.contains('open')");
assert((await evaluate("document.querySelectorAll('.note-card').length")) >= 1, "Saved note card should exist");
await evaluate(`(() => { const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)}); card.click(); return true; })()`);
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
await waitFor("!document.querySelector('#noteEditorWrap').hidden");
await waitFor("document.activeElement?.id === 'noteEditor'");
assert(await evaluate("document.querySelector('#noteSubtitleInput').value") === testSubtitle, "Saved subtitle should reopen in the editor");
await click("#closeNoteButton");
await waitFor("!document.querySelector('#noteOverlay').classList.contains('open')");
console.log("card/close and direct editing: ok");
const secondTitle = `Second ${Date.now()}`;
await click("#newNoteButton");
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
await evaluate(`(() => {
  const title = document.querySelector('#noteTitleInput');
  title.value = ${JSON.stringify(secondTitle)};
  title.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true })); true");
await waitForFileText("C:/sema/NotesApp/.test-data/notes.json", secondTitle);
await click("#closeNoteButton");
await waitFor("document.querySelectorAll('.note-card').length === 2");
const compactCard = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)});
  const mark = card && card.querySelector('.select-mark');
  return {
    exists: Boolean(card),
    preview: Boolean(card && card.querySelector('p')),
    footer: Boolean(card && card.querySelector('.card-footer')),
    hasNoteIcon: Boolean(card && card.querySelector('.card-icon')),
    selectionIcon: mark ? mark.querySelector('use')?.getAttribute('href') || '' : '',
    selectionInMain: Boolean(mark && mark.closest('.note-card-main')),
    role: mark ? mark.getAttribute('role') : '',
    height: card ? Math.round(card.getBoundingClientRect().height) : 0,
    fontSize: card ? getComputedStyle(card.querySelector('h3')).fontSize : ''
  };
})()`);
assert(compactCard.exists, "Compact note card should exist");
assert(!compactCard.preview && !compactCard.footer, "Note card should not show snippet or footer");
assert(!compactCard.hasNoteIcon, "Note card should not show the note icon");
assert(compactCard.selectionInMain, "Trash checkbox should sit where the note icon was");
assert(compactCard.selectionIcon === "#i-trash" && compactCard.role === "checkbox", "Trash mark should work as selection checkbox");
assert(compactCard.height <= 100, `Note card should be compact, got ${compactCard.height}px`);
assert(compactCard.fontSize === "21px", "Compact card should keep the 21px title size");
console.log("compact card and trash selection: ok");

const dragResult = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.note-card'));
  const source = cards.find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)});
  const target = cards.find((item) => item.querySelector('h3').textContent === ${JSON.stringify(secondTitle)});
  if (!source || !target) return 'missing';
  source.dataset.testMarker = 'kept';
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const rect = target.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  return 'ok';
})()`);
assert(dragResult === "ok", "Drag-and-drop should start from both note cards");
await waitFor(`(() => {
  const titles = Array.from(document.querySelectorAll('.note-card h3')).map((node) => node.textContent);
  return titles.indexOf(${JSON.stringify(secondTitle)}) >= 0 && titles.indexOf(${JSON.stringify(secondTitle)}) < titles.indexOf(${JSON.stringify(testTitle)});
})()`);
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => {
  const titles = state.Notes.map((note) => note.Title);
  return titles.indexOf(secondTitle) >= 0 && titles.indexOf(secondTitle) < titles.indexOf(testTitle);
});
assert(await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)});
  return card?.dataset.testMarker === 'kept';
})()`), "Dragging should move the existing card without rebuilding the grid");
console.log("drag reorder without grid refresh: ok");

const copyDrag = await evaluate(`(() => {
  const source = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(secondTitle)});
  const target = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)});
  if (!source || !target) return false;
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer }));
  const rect = target.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer }));
  return true;
})()`);
assert(copyDrag, "Alt-drag should find source and target notes");
const copiedTitle = `${secondTitle} (копия)`;
await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(copiedTitle)})`);
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => state.Notes.some((note) => note.Title === copiedTitle));
console.log("alt-drag copy: ok");

const emptyAreaCopy = await evaluate(`(() => {
  const source = Array.from(document.querySelectorAll('.note-card')).find(
    (item) => item.querySelector('h3')?.textContent === ${JSON.stringify(testTitle)}
  );
  const grid = document.querySelector('#grid');
  if (!source || !grid) return null;
  const before = document.querySelectorAll('.note-card').length;
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer }));
  const rect = grid.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer, clientX: rect.right - 8, clientY: rect.bottom - 8 };
  grid.dispatchEvent(new DragEvent('dragover', init));
  grid.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, altKey: true, dataTransfer: transfer }));
  return { before, after: document.querySelectorAll('.note-card').length };
})()`);
assert(emptyAreaCopy, "Alt-drag to empty grid should find the source note");
const emptyAreaCopyTitle = `${testTitle} (копия)`;
await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(emptyAreaCopyTitle)})`);
const emptyAreaCopyCount = await evaluate("document.querySelectorAll('.note-card').length");
assert(emptyAreaCopyCount === emptyAreaCopy.before + 1, "Alt-drag to empty grid should create exactly one copy");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => state.Notes.some((note) => note.Title === emptyAreaCopyTitle));
await wait(650);
await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find(
    (item) => item.querySelector('h3')?.textContent === ${JSON.stringify(emptyAreaCopyTitle)}
  );
  card?.querySelector('.select-mark')?.click();
  return Boolean(card);
})()`);
await click("#deleteButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await click("#dialogConfirm");
await waitFor(`!Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(emptyAreaCopyTitle)})`);
console.log("alt-drag copy to empty grid area: ok");

await send("Page.reload");
await waitFor("document.querySelector('#loadingScreen') && document.querySelector('#loadingScreen').classList.contains('hide')", 12000);
await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(testTitle)})`, 6000);
const orderAfterReload = await evaluate("Array.from(document.querySelectorAll('.note-card h3')).map((node) => node.textContent)");
assert(orderAfterReload.indexOf(secondTitle) >= 0 && orderAfterReload.indexOf(secondTitle) < orderAfterReload.indexOf(testTitle), "Reordered cards should persist after reload");
console.log("restart persistence: ok");

await createCategory("Работа");
await createCategory("Идеи");
const workColor = "#3F7A68";
const colorChanged = await evaluate(`(() => {
  const chip = Array.from(document.querySelectorAll('.category-chip')).find((item) => item.querySelector('.category-name')?.textContent === 'Работа');
  const input = chip?.querySelector('.category-color');
  if (!input) return false;
  input.value = ${JSON.stringify(workColor)};
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert(colorChanged, "Category color input should exist");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => state.Categories?.some((category) => category.Name === "Работа" && category.Color === workColor));
await assignCategoryToNote("Работа", testTitle);
await assignCategoryToNote("Идеи", secondTitle);
await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).findIndex((node) => node.textContent === ${JSON.stringify(testTitle)}) < Array.from(document.querySelectorAll('.note-card h3')).findIndex((node) => node.textContent === ${JSON.stringify(secondTitle)})`);
console.log("category create, color and note badge: ok");

const categoryDrag = await evaluate(`(() => {
  const chips = Array.from(document.querySelectorAll('.category-chip'));
  const source = chips.find((item) => item.querySelector('.category-name')?.textContent === 'Идеи');
  const target = chips.find((item) => item.querySelector('.category-name')?.textContent === 'Работа');
  if (!source || !target) return false;
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const rect = target.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  return true;
})()`);
assert(categoryDrag, "Category chips should be draggable");
await waitFor("document.querySelector('.category-chip .category-name')?.textContent === 'Идеи'");
await waitFor(`Array.from(document.querySelectorAll('.note-card h3')).findIndex((node) => node.textContent === ${JSON.stringify(secondTitle)}) < Array.from(document.querySelectorAll('.note-card h3')).findIndex((node) => node.textContent === ${JSON.stringify(testTitle)})`);
const priorityState = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(secondTitle)});
  return { marked: card?.classList.contains('priority-start') || false, gridColumnStart: card ? getComputedStyle(card).gridColumnStart : '' };
})()`);
assert(priorityState.marked && priorityState.gridColumnStart === "1", "First note of the highest-priority category should start a new grid row");
console.log("category priority sorting and reorder: ok");

const resizeBefore = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(testTitle)});
  const handle = card?.querySelector('.card-resize-handle.right');
  if (!card || !handle) return null;
  const rect = card.getBoundingClientRect();
  return { span: Number(card.style.getPropertyValue('--card-span')), width: rect.width, cursor: getComputedStyle(handle).cursor, background: getComputedStyle(handle).backgroundColor };
})()`);
assert(resizeBefore && resizeBefore.cursor === "col-resize", "Note resize handle should use the col-resize cursor");
assert(resizeBefore.background === "rgba(0, 0, 0, 0)", "Resize handles should remain invisible");
const resized = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(testTitle)});
  const handle = card.querySelector('.card-resize-handle.right');
  const rect = card.getBoundingClientRect();
  const pointer = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0 };
  handle.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: rect.right - 2 }));
  window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: rect.right + 240 }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: rect.right + 240 }));
  return { span: Number(card.style.getPropertyValue('--card-span')), width: card.getBoundingClientRect().width };
})()`);
assert(resized.span > resizeBefore.span && resized.width > resizeBefore.width, "Dragging a card edge should widen the card");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Notes || []).some((note) => note.Title === testTitle && note.WidthSpan > resizeBefore.span));
console.log("note card horizontal resize: ok");

await send("Page.reload");
await waitFor("document.querySelector('#loadingScreen') && document.querySelector('#loadingScreen').classList.contains('hide')", 12000);
await waitFor("document.querySelectorAll('.note-card').length >= 3");
const persistedLayout = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === ${JSON.stringify(testTitle)});
  return {
    span: Number(card?.style.getPropertyValue('--card-span')),
    firstCategory: document.querySelector('.category-chip .category-name')?.textContent,
    badge: card?.querySelector('.note-category')?.textContent
  };
})()`);
assert(persistedLayout.span > resizeBefore.span, "Card width should persist after reload");
assert(persistedLayout.firstCategory === "Идеи" && persistedLayout.badge === "Работа", "Category priority and badge should persist after reload");
console.log("category and width persistence: ok");

await click("#newFolderButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = 'Личное'; return true; })()`);
await click("#dialogConfirm");
await waitFor("Array.from(document.querySelectorAll('.folder-card h3')).some((node) => node.textContent === 'Личное')");
const folderResize = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  const handle = card?.querySelector('.card-resize-handle.right');
  if (!card || !handle) return null;
  const rect = card.getBoundingClientRect();
  const cursor = getComputedStyle(handle).cursor;
  const before = Number(card.style.getPropertyValue('--card-span'));
  const pointer = { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'mouse', button: 0 };
  handle.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: rect.right - 2 }));
  window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: rect.right + 240 }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: rect.right + 240 }));
  return { cursor, before, after: Number(card.style.getPropertyValue('--card-span')) };
})()`);
assert(folderResize && folderResize.cursor === "col-resize" && folderResize.after > folderResize.before, "Folder cards should resize horizontally");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Folders || []).some((folder) => folder.Name === "Личное" && folder.WidthSpan > folderResize.before));
await wait(500);
console.log("folder create and resize: ok");

await click("#newFolderButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = 'Вторая папка'; return true; })()`);
await click("#dialogConfirm");
await waitFor("Array.from(document.querySelectorAll('.folder-card h3')).some((node) => node.textContent === 'Вторая папка')");
await wait(300);
const folderDrag = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.folder-card'));
  const source = cards.find((item) => item.querySelector('h3')?.textContent === 'Личное');
  const target = cards.find((item) => item.querySelector('h3')?.textContent === 'Вторая папка');
  if (!source || !target) return false;
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const rect = target.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  return true;
})()`);
assert(folderDrag, "Folder drag should find both folder cards");
await waitFor(`(() => {
  const titles = Array.from(document.querySelectorAll('.folder-card h3')).map((node) => node.textContent);
  return titles.indexOf('Вторая папка') >= 0 && titles.indexOf('Вторая папка') < titles.indexOf('Личное');
})()`);
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => {
  const names = (state.Folders || []).map((folder) => folder.Name);
  return names.indexOf("Вторая папка") >= 0 && names.indexOf("Вторая папка") < names.indexOf("Личное");
});
console.log("folder drag reorder: ok");

await assignCategoryToFolder("Работа", "Личное");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Folders || []).some((folder) => folder.Name === "Личное" && (state.Categories || []).some((category) => category.Id === folder.CategoryId && category.Name === "Работа" && !category.OwnerFolderId)));
const rootFolderBadge = await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((card) => card.querySelector('h3')?.textContent === 'Личное')?.querySelector('.note-category')?.textContent || ''");
assert(rootFolderBadge === "Работа", "Root category should be assignable to a folder card");
console.log("root category on folder card: ok");

await wait(650);
const plainFolderControls = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Вторая папка');
  if (!card) return null;
  const cover = card.querySelector('[data-folder-card-background]');
  const count = card.querySelector('p');
  return {
    coverOpacity: cover ? Number(getComputedStyle(cover).opacity) : 0,
    countOpacity: count ? Number(getComputedStyle(count).opacity) : 0,
    hasClear: Boolean(card.querySelector('[data-folder-card-background-clear]')),
    hasOpenArrow: Boolean(card.querySelector('.folder-open-arrow'))
  };
})()`);
assert(plainFolderControls, "A folder without a card photo should be available");
assert(plainFolderControls.coverOpacity > 0.5 && plainFolderControls.countOpacity > 0.9, "Folders without a photo should keep their controls always visible");
assert(!plainFolderControls.hasClear && !plainFolderControls.hasOpenArrow, "Folders without a photo should not show the clear button or footer arrow");
console.log("folder controls without photo: ok");

const folderTextLayoutBefore = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  if (!card) return null;
  const cardRect = card.getBoundingClientRect();
  const measure = (node) => {
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return { left: rect.left - cardRect.left, top: rect.top - cardRect.top, width: rect.width, height: rect.height };
  };
  return {
    title: measure(card.querySelector('h3')),
    count: measure(card.querySelector('p')),
    date: measure(card.querySelector('.card-footer > span:first-child'))
  };
})()`);
assert(folderTextLayoutBefore, "Folder text layout should be available before applying a card background");
const folderCoverButton = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  const button = card?.querySelector('[data-folder-card-background]');
  const input = document.querySelector('#folderBackgroundInput');
  if (!button || !input) return null;
  const originalClick = input.click;
  let opened = false;
  input.click = () => { opened = true; };
  button.click();
  input.click = originalClick;
  return {
    icon: button.querySelector('use')?.getAttribute('href') || '',
    title: button.title,
    opened,
    pressed: button.getAttribute('aria-pressed')
  };
})()`);
assert(folderCoverButton?.icon === '#i-image', "Folder card should show a photo button");
assert(folderCoverButton.opened && /фото/i.test(folderCoverButton.title), "Folder photo button should open the card-background picker");
assert(folderCoverButton.pressed === 'false', "Folder photo button should expose background state");
const coverUploaded = await evaluate(`(() => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const file = new File([bytes], 'folder-card-cover.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#folderBackgroundInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert(coverUploaded, "Folder card background file should be submitted");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Folders || []).some((folder) => folder.Name === 'Личное' && /^data:image\/webp;base64,/.test(folder.CardBackgroundImage || '') && !folder.BackgroundImage));
await waitFor("Array.from(document.querySelectorAll('.folder-card')).some((card) => card.querySelector('h3')?.textContent === 'Личное' && card.classList.contains('has-card-background'))", 8000);
const folderCardBackgroundState = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  const button = card?.querySelector('[data-folder-card-background]');
  return {
    cardImage: card ? getComputedStyle(card).backgroundImage : '',
    active: Boolean(button?.classList.contains('has-card-background')),
    pressed: button?.getAttribute('aria-pressed'),
    clearVisible: Boolean(card?.querySelector('[data-folder-card-background-clear]')),
    groupedCopy: Boolean(card?.querySelector('.folder-card-copy')),
    textBacking: {
      title: card?.querySelector('h3') ? getComputedStyle(card.querySelector('h3')).backgroundImage : 'none',
      count: card?.querySelector('p') ? getComputedStyle(card.querySelector('p')).backgroundImage : 'none',
      date: card?.querySelector('.card-footer > span:first-child') ? getComputedStyle(card.querySelector('.card-footer > span:first-child')).backgroundImage : 'none'
    }
  };
})()`);
assert(folderCardBackgroundState.cardImage.includes('data:image/webp'), "Folder card should render its own background photo");
assert(folderCardBackgroundState.active && folderCardBackgroundState.pressed === 'true' && folderCardBackgroundState.clearVisible, "Folder card photo controls should reflect the applied background");
assert(!folderCardBackgroundState.groupedCopy, "Folder labels should stay separate instead of being grouped into one block");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
await wait(250);
const hiddenPhotoControls = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  if (!card) return null;
  const opacity = (selector) => {
    const node = card.querySelector(selector);
    return node ? Number(getComputedStyle(node).opacity) : -1;
  };
  return {
    cover: opacity('[data-folder-card-background]'),
    clear: opacity('[data-folder-card-background-clear]'),
    count: opacity('p')
  };
})()`);
assert(hiddenPhotoControls, "Photo folder controls should be available");
for (const key of ["cover", "clear", "count"]) {
  assert(hiddenPhotoControls[key] < 0.1, `Folder photo ${key} should be hidden until the card is hovered`);
}
const hoverPoint = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  if (!card) return null;
  card.scrollIntoView({ block: 'center' });
  const rect = card.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
assert(hoverPoint, "Photo folder card should be hoverable");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverPoint.x, y: hoverPoint.y });
await waitFor(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  if (!card) return false;
  return ['[data-folder-card-background]', '[data-folder-card-background-clear]', 'p'].every(
    (selector) => Number(getComputedStyle(card.querySelector(selector)).opacity) > 0.9
  );
})()`, 4000);
const hoveredPhotoControls = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  const cover = card?.querySelector('[data-folder-card-background]');
  const clear = card?.querySelector('[data-folder-card-background-clear]');
  if (!cover || !clear) return null;
  const coverRect = cover.getBoundingClientRect();
  const clearRect = clear.getBoundingClientRect();
  return {
    coverLeft: coverRect.left,
    coverRight: coverRect.right,
    clearLeft: clearRect.left,
    hasOpenArrow: Boolean(card.querySelector('.folder-open-arrow'))
  };
})()`);
assert(hoveredPhotoControls && hoveredPhotoControls.clearLeft >= hoveredPhotoControls.coverRight - 1, "Clear button should appear to the right of the photo button");
assert(!hoveredPhotoControls.hasOpenArrow, "Folder footer arrow should be removed");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
console.log("folder photo hover controls: ok");
assert(!folderCardBackgroundState.cardImage.includes('linear-gradient'), "Folder card photo should not be covered by a veil");
for (const key of ["title", "count", "date"]) {
  assert(folderCardBackgroundState.textBacking[key] !== "none", `Folder ${key} should have its own readable backing`);
}
const folderTextLayoutAfter = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное');
  if (!card) return null;
  const cardRect = card.getBoundingClientRect();
  const measure = (node) => {
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return { left: rect.left - cardRect.left, top: rect.top - cardRect.top };
  };
  return {
    title: measure(card.querySelector('h3')),
    count: measure(card.querySelector('p')),
    date: measure(card.querySelector('.card-footer > span:first-child'))
  };
})()`);
assert(folderTextLayoutAfter, "Folder text layout should remain available after applying a card background");
for (const key of ["title", "count", "date"]) {
  assert(Math.abs(folderTextLayoutAfter[key].left - folderTextLayoutBefore[key].left) < 1, `Folder ${key} should keep its horizontal position`);
  assert(Math.abs(folderTextLayoutAfter[key].top - folderTextLayoutBefore[key].top) < 1, `Folder ${key} should keep its vertical position`);
}
console.log("folder card background from card: ok");

await evaluate(`(() => { const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3').textContent === 'Личное'); if (!card) return false; card.click(); return true; })()`);
await waitFor("document.querySelector('.crumb.current').textContent.includes('Личное')");
const backgroundFolderId = await evaluate("document.querySelector('.crumb.current')?.dataset.crumb || ''");
assert(backgroundFolderId, "Folder id should be available for background test");
const hiddenRootScope = await evaluate("({ names: Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent), empty: document.querySelector('.category-empty')?.textContent || '' })");
assert(!hiddenRootScope.names.includes("Работа") && !hiddenRootScope.names.includes("Идеи"), "Root categories should not leak into a folder");
assert(hiddenRootScope.empty.includes("Нет категорий"), "Folder category bar should explain that the local scope is empty");
assert(!(await evaluate("document.querySelector('#canvas').classList.contains('has-folder-background')")), "Folder card photo should not become the folder interior background");
console.log("folder category scope isolation: ok");
const backgroundUploaded = await evaluate(`(() => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const file = new File([bytes], 'folder-background.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#folderBackgroundInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert(backgroundUploaded, "Folder background file should be submitted");
await waitFor("document.querySelector('#canvas').classList.contains('has-folder-background')", 8000);
const backgroundStyle = await evaluate("document.querySelector('#canvas').style.getPropertyValue('--folder-background')");
assert(backgroundStyle.includes("data:image/webp"), "Folder background should be optimized and applied");
await send("Page.reload");
await waitFor("document.querySelector('#loadingScreen') && document.querySelector('#loadingScreen').classList.contains('hide')", 12000);
await waitFor(`document.querySelector('.folder-card[data-id="${backgroundFolderId}"]') !== null`);
const persistedFolderBadge = await evaluate(`document.querySelector('.folder-card[data-id="${backgroundFolderId}"]')?.querySelector('.note-category')?.textContent || ''`);
assert(persistedFolderBadge === "Работа", "Folder category badge should persist after reload");
const persistedCardBackground = await evaluate(`(() => {
  const card = document.querySelector('.folder-card[data-id="${backgroundFolderId}"]');
  return {
    applied: Boolean(card?.classList.contains('has-card-background')),
    image: card ? getComputedStyle(card).backgroundImage : ''
  };
})()`);
assert(persistedCardBackground.applied && persistedCardBackground.image.includes('data:image/webp'), "Folder card background should persist after reload");
await click(`.folder-card[data-id="${backgroundFolderId}"]`);
await waitFor(`document.querySelector('.crumb.current')?.dataset.crumb === ${JSON.stringify(backgroundFolderId)}`);
await waitFor("document.querySelector('#canvas').classList.contains('has-folder-background')", 8000);
console.log("folder background persistence: ok");

await createCategory("Личная");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Categories || []).some((category) => category.Name === "Личная" && category.OwnerFolderId === backgroundFolderId));
const localCategoryNames = await evaluate("Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent)");
assert(localCategoryNames.length === 1 && localCategoryNames[0] === "Личная", "A folder should show only its own categories");
console.log("folder-local category creation: ok");
assert(await evaluate("!document.querySelector('#emptyState').hidden"), "Folder should start empty");
await click("#newFolderButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = 'Дневник'; return true; })()`);
await click("#dialogConfirm");
await waitFor("Array.from(document.querySelectorAll('.folder-card h3')).some((node) => node.textContent === 'Дневник')");
await assignCategoryToFolder("Личная", "Дневник");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Folders || []).some((folder) => folder.Name === "Дневник" && (state.Categories || []).some((category) => category.Id === folder.CategoryId && category.Name === "Личная" && category.OwnerFolderId === backgroundFolderId)));
await evaluate(`(() => { const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3').textContent === 'Дневник'); card.click(); return true; })()`);
await waitFor("document.querySelector('.crumb.current').textContent.includes('Дневник')");
assert(await evaluate("document.querySelector('#breadcrumbs').textContent.includes('Личное')"), "Nested folder should keep parent crumb");
const nestedFolderId = await evaluate("document.querySelector('.crumb.current')?.dataset.crumb || ''");
assert(nestedFolderId, "Nested folder id should be available");
const nestedScope = await evaluate("Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent)");
assert(!nestedScope.includes("Личная"), "A parent folder category should not leak into a nested folder");
assert(await evaluate("!document.querySelector('#emptyState').hidden"), "Nested folder should start empty");
await click("#emptyNewNote");
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
await evaluate(`(() => { const title = document.querySelector('#noteTitleInput'); title.value = 'Заметка в папке'; title.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await wait(900);
await click("#closeNoteButton");
await wait(300);

await createCategory("Глубокая");
await assignCategoryToNote("Глубокая", "Заметка в папке");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Notes || []).some((note) => note.Title === "Заметка в папке" && (state.Categories || []).some((category) => category.Id === note.CategoryId && category.Name === "Глубокая" && category.OwnerFolderId === nestedFolderId)));
console.log("nested folder category and note badge: ok");

await send("Page.reload");
await waitFor("document.querySelector('#loadingScreen') && document.querySelector('#loadingScreen').classList.contains('hide')", 12000);
await waitFor("document.querySelector('.crumb.current')?.dataset.crumb === 'root'");
await waitFor("Array.from(document.querySelectorAll('.category-chip .category-name')).some((node) => node.textContent === 'Работа')");
const rootScopeAfterReload = await evaluate("Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent)");
assert(rootScopeAfterReload.includes("Работа") && !rootScopeAfterReload.includes("Личная") && !rootScopeAfterReload.includes("Глубокая"), "Root category bar should restore only root categories after reload");
await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Личное')?.click(); true");
await waitFor(`document.querySelector('.crumb.current')?.dataset.crumb === ${JSON.stringify(backgroundFolderId)}`);
const personalScopeAfterReload = await evaluate("Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent)");
assert(personalScopeAfterReload.length === 1 && personalScopeAfterReload[0] === "Личная", "The parent folder should restore only its local categories");
const childFolderBadge = await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((card) => card.querySelector('h3')?.textContent === 'Дневник')?.querySelector('.note-category')?.textContent || ''");
assert(childFolderBadge === "Личная", "A folder category badge should persist on a child folder card");
await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Дневник')?.click(); true");
await waitFor(`document.querySelector('.crumb.current')?.dataset.crumb === ${JSON.stringify(nestedFolderId)}`);
const nestedScopeAfterReload = await evaluate("Array.from(document.querySelectorAll('.category-chip .category-name')).map((node) => node.textContent)");
assert(nestedScopeAfterReload.length === 1 && nestedScopeAfterReload[0] === "Глубокая", "A nested folder should restore only its own categories");
const nestedNoteBadge = await evaluate("Array.from(document.querySelectorAll('.note-card')).find((card) => card.querySelector('h3')?.textContent === 'Заметка в папке')?.querySelector('.note-category')?.textContent || ''");
assert(nestedNoteBadge === "Глубокая", "A note category badge should persist within its folder scope");
console.log("scoped category isolation and persistence: ok");

await click('[data-crumb="root"]');
await waitFor("document.querySelectorAll('.card').length > 0");
console.log("nested note: ok");

await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3').textContent === ${JSON.stringify(testTitle)});
  if (!card) return false;
  card.querySelector('.select-mark').click();
  return true;
})()`);
await waitFor("document.querySelector('#selectionCount').textContent === '1'");
await click("#deleteButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await click("#dialogConfirm");
await wait(700);
assert(!(await evaluate(`Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === ${JSON.stringify(testTitle)})`)), "Deleted note should disappear");
console.log("delete: ok");

await click("#newNoteButton");
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
await evaluate(`(() => {
  const title = document.querySelector('#noteTitleInput');
  title.value = 'С картинкой';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const file = new File([bytes], 'pixel.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const editor = document.querySelector('#noteEditor');
  editor.focus();
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  return true;
})()`);
await wait(2200);
const imageState = await evaluate(`({ images: document.querySelectorAll('#noteEditor img').length, source: document.querySelector('#noteEditor img')?.src.slice(0, 30) || '' })`);
console.log("image paste:", JSON.stringify(imageState));
assert(imageState.images === 1 && imageState.source.startsWith("data:image/webp"), "Pasted image should be optimized and inserted");
await evaluate("document.querySelector('#noteEditor img').click(); true");
await waitFor("!document.querySelector('#imageResizeToolbar').hidden");
await click("#imageWiderButton");
const resizedImage = await evaluate(`({
  width: document.querySelector('#noteEditor img').style.width,
  label: document.querySelector('#imageSizeLabel').textContent
})`);
assert(/^\d+%$/.test(resizedImage.width), "Image should receive a percentage width");
assert(resizedImage.label === resizedImage.width, "Resize toolbar should show the current width");
await wait(600);
const unsavedImageNote = fs.readFileSync("C:/sema/NotesApp/.test-data/notes.json", "utf8");
assert(!/width:\s*\d+%/.test(unsavedImageNote), "Image resize should wait for manual save");
await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true })); true");
await waitForFilePattern("C:/sema/NotesApp/.test-data/notes.json", /width:\s*\d+%/, 8000);
console.log("image resize and Ctrl+S: ok");
await click("#closeNoteButton");
await wait(500);

const folderSelected = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3').textContent === 'Личное');
  if (!card) return false;
  card.querySelector('.select-mark').click();
  return true;
})()`);
assert(folderSelected, "Folder card should be selectable");
await waitFor("document.querySelector('#selectionCount').textContent === '1'");
await click("#deleteButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await click("#dialogConfirm");
await waitFor("!Array.from(document.querySelectorAll('.folder-card h3')).some((node) => node.textContent === 'Личное')", 6000);
const finalState = JSON.parse(fs.readFileSync("C:/sema/NotesApp/.test-data/notes.json", "utf8"));
assert(!finalState.Folders.some((folder) => folder.Name === 'Личное'), "Deleted folder should be persisted");
assert(!finalState.Notes.some((note) => note.Title === 'Заметка в папке'), "Nested note should be deleted with folder");
assert(!(finalState.Categories || []).some((category) => category.OwnerFolderId === backgroundFolderId || category.OwnerFolderId === nestedFolderId), "Deleted folders should remove their owned categories");
assert(finalState.Notes.some((note) => note.Title === 'С картинкой'), "Unrelated image note should remain");
console.log("folder cascade delete: ok");
await evaluate(`(() => {
  window.__originalSpeechApis = {
    recognition: window.SpeechRecognition,
    webkit: window.webkitSpeechRecognition
  };
  class MockSpeechRecognition {
    constructor() {
      this.lang = "";
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      window.__voiceMock = this;
    }
    start() {
      if (typeof this.onstart === "function") this.onstart();
      setTimeout(() => {
        const result = [{ transcript: "Привет, это проверка голоса" }];
        result.isFinal = true;
        if (typeof this.onresult === "function") {
          this.onresult({ resultIndex: 0, results: [result] });
        }
      }, 60);
    }
    abort() {
      if (typeof this.onend === "function") this.onend();
    }
  }
  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
  return true;
})()`);
await click("#newNoteButton");
await waitFor("document.querySelector('#noteOverlay').classList.contains('open')");
await waitFor("document.activeElement && document.activeElement.id === 'noteTitleInput'");
await click("#voiceButton");
await waitFor("document.querySelector('#noteEditor').innerText.includes('Привет, это проверка голоса')", 4000);
const voiceState = await evaluate(`({
  lang: window.__voiceMock?.lang || '',
  continuous: window.__voiceMock?.continuous,
  interim: window.__voiceMock?.interimResults,
  listening: document.querySelector('#voiceButton').classList.contains('listening')
})`);
assert(voiceState.lang === "ru-RU", "Voice recognition should use Russian");
assert(voiceState.continuous === true && voiceState.interim === true, "Voice recognition should run continuously with interim results");
assert(voiceState.listening, "Microphone should show an active listening state");
await click("#voiceButton");
await wait(200);
assert(!(await evaluate("document.querySelector('#voiceButton').classList.contains('listening')")), "Second microphone click should stop listening");
await click("#closeNoteButton");
await wait(400);
await evaluate(`(() => {
  if (window.__originalSpeechApis.recognition) window.SpeechRecognition = window.__originalSpeechApis.recognition;
  else delete window.SpeechRecognition;
  if (window.__originalSpeechApis.webkit) window.webkitSpeechRecognition = window.__originalSpeechApis.webkit;
  else delete window.webkitSpeechRecognition;
  delete window.__originalSpeechApis;
  delete window.__voiceMock;
  return true;
})()`);
console.log("voice input mock: ok");
const engineMessages = await evaluate(`new Promise((resolve) => {

  const id = 'engines-check';
  const listener = (event) => {
    if (!event.data || event.data.id !== id) return;
    window.chrome.webview.removeEventListener('message', listener);
    resolve(event.data);
  };
  window.chrome.webview.addEventListener('message', listener);
  window.chrome.webview.postMessage({ id, command: 'list_speech_engines', args: {} });
  setTimeout(() => resolve({ timeout: true }), 5000);
})`);
assert(!engineMessages.timeout && engineMessages.ok, "Speech bridge should respond");
console.log("speech engines:", JSON.stringify(engineMessages.result));

await click('[data-crumb="root"]');
await waitFor("document.querySelector('.crumb.current')?.dataset.crumb === 'root'");
await click("#newFolderButton");
await waitFor("document.querySelector('#dialogLayer').classList.contains('open')");
await evaluate(`(() => { const input = document.querySelector('#dialogInput'); input.value = 'Иерархия'; return true; })()`);
await click("#dialogConfirm");
await waitFor("Array.from(document.querySelectorAll('.folder-card h3')).some((node) => node.textContent === 'Иерархия')");
await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Иерархия')?.click(); true");
await waitFor("document.querySelector('.crumb.current')?.textContent.includes('Иерархия')");
const hierarchyFolderId = await evaluate("document.querySelector('.crumb.current')?.dataset.crumb || ''");
assert(hierarchyFolderId, "Hierarchy folder id should be available");

await createCategory("Класс");
await createCategory("Предмет");
await createCategory("Источник");
await createSubcategory("Класс", "10А");
await createSubcategory("Класс", "10Б");
await createSubcategory("Предмет", "Алгебра");
await createSubcategory("Предмет", "Геометрия");
await createSubcategory("Источник", "Сайт");
await createSubcategory("Источник", "Знакомые");
const hierarchyShape = await evaluate(`(() => Array.from(document.querySelectorAll('.category-group')).map((group) => ({
  name: group.querySelector('.category-chip .category-name')?.textContent || '',
  children: Array.from(group.querySelectorAll('.category-subchip .category-name')).map((node) => node.textContent)
})))()`);
assert(hierarchyShape.length === 3, "Three main category groups should be visible");
assert(hierarchyShape[0].name === "Класс" && hierarchyShape[0].children.join(',') === "10А,10Б", "The class group should contain ordered subcategories");

await createTestNote("Ученик C");
await createTestNote("Ученик B");
await createTestNote("Ученик A");
await assignSubcategoryToNote("10А", "Ученик C");
await assignSubcategoryToNote("10А", "Ученик B");
await assignSubcategoryToNote("10Б", "Ученик A");
await assignSubcategoryToNote("Алгебра", "Ученик C");
await assignSubcategoryToNote("Геометрия", "Ученик B");
await assignSubcategoryToNote("Алгебра", "Ученик A");
await assignSubcategoryToNote("Сайт", "Ученик C");
await assignSubcategoryToNote("Знакомые", "Ученик B");
await assignSubcategoryToNote("Сайт", "Ученик A");

const classOrderJson = JSON.stringify(["Ученик C", "Ученик B", "Ученик A"]);
await waitFor(`JSON.stringify(Array.from(document.querySelectorAll('.note-card h3')).map((node) => node.textContent)) === ${JSON.stringify(classOrderJson)}`);
const classRows = await evaluate(`(() => Array.from(document.querySelectorAll('.note-card')).filter((card) => card.classList.contains('priority-start')).map((card) => ({ title: card.querySelector('h3')?.textContent || '', column: getComputedStyle(card).gridColumnStart })))()`);
assert(classRows.length === 2 && classRows[0].title === "Ученик C" && classRows[1].title === "Ученик A" && classRows.every((row) => row.column === "1"), "Each class subcategory should start a new row in priority order");
const threeBadgeRow = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === 'Ученик C');
  const badges = Array.from(card?.querySelectorAll('.note-category') || []);
  const top = badges[0]?.getBoundingClientRect().top;
  return {
    count: badges.length,
    sameRow: badges.length === 3 && badges.every((badge) => Math.abs(badge.getBoundingClientRect().top - top) < 1),
    cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0
  };
})()`);
assert(threeBadgeRow.count === 3 && threeBadgeRow.sameRow, `Three category badges should fit on one standard card row, got ${JSON.stringify(threeBadgeRow)}`);
console.log("nested category sorting and row boundaries: ok");

const reorderRoot = async (sourceName, targetName) => {
  const moved = await evaluate(`(() => {
    const chips = Array.from(document.querySelectorAll('.category-chip'));
    const source = chips.find((item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(sourceName)});
    const target = chips.find((item) => item.querySelector('.category-name')?.textContent === ${JSON.stringify(targetName)});
    if (!source || !target) return false;
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  assert(moved, `Root category reorder should find ${sourceName} and ${targetName}`);
  await waitFor(`document.querySelector('.category-chip .category-name')?.textContent === ${JSON.stringify(sourceName)}`);
};
await reorderRoot("Предмет", "Класс");
const subjectOrderJson = JSON.stringify(["Ученик C", "Ученик A", "Ученик B"]);
await waitFor(`JSON.stringify(Array.from(document.querySelectorAll('.note-card h3')).map((node) => node.textContent)) === ${JSON.stringify(subjectOrderJson)}`);
const subjectRows = await evaluate(`(() => Array.from(document.querySelectorAll('.note-card')).filter((card) => card.classList.contains('priority-start')).map((card) => card.querySelector('h3')?.textContent || ''))()`);
assert(subjectRows.length === 2 && subjectRows[0] === "Ученик C" && subjectRows[1] === "Ученик B", "Reordering the primary group should rebuild row boundaries");
await reorderRoot("Класс", "Предмет");
await waitFor(`JSON.stringify(Array.from(document.querySelectorAll('.note-card h3')).map((node) => node.textContent)) === ${JSON.stringify(classOrderJson)}`);
console.log("primary group reorder and grid rebuild: ok");

const customColor = "#AA5533";
const subcategoryColorChanged = await evaluate(`(() => {
  const chip = Array.from(document.querySelectorAll('.category-subchip')).find((item) => item.querySelector('.category-name')?.textContent === '10А');
  const input = chip?.querySelector('.category-color');
  if (!input) return false;
  input.value = ${JSON.stringify(customColor)};
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert(subcategoryColorChanged, "Subcategory color input should exist");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => (state.Categories || []).some((category) => category.Name === "10А" && category.Color === customColor));
assert(!(await evaluate("document.querySelector('.category-color-source')")), "Subcategory color copy selector should be removed");

await renameCategoryChip("10А", "10А (новый)", ".category-subchip");
const renamedBadge = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === 'Ученик C');
  return Array.from(card?.querySelectorAll('.note-category') || []).map((node) => node.textContent);
})()`);
assert(renamedBadge.includes("10А (новый)"), "Renamed subcategory should update the note badge");
await renameCategoryChip("10А (новый)", "10А", ".category-subchip");
await renameCategoryChip("Класс", "Класс (новый)", ".category-chip");
await renameCategoryChip("Класс (новый)", "Класс", ".category-chip");
console.log("category and subcategory rename: ok");

const categoryToggleOpen = await evaluate(`(() => {
  const button = document.querySelector('#categoryToggleButton');
  const bar = document.querySelector('#categoryBar');
  const buttonRect = button.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  return { left: buttonRect.left, top: buttonRect.top, width: buttonRect.width, height: buttonRect.height, rightGap: barRect.right - buttonRect.right };
})()`);
await click("#categoryToggleButton");
await waitFor("document.querySelector('#categoryBar').classList.contains('is-collapsed')");
const categoryToggleCollapsed = await evaluate(`(() => {
  const button = document.querySelector('#categoryToggleButton');
  const bar = document.querySelector('#categoryBar');
  const buttonRect = button.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  return {
    left: buttonRect.left,
    top: buttonRect.top,
    width: buttonRect.width,
    height: buttonRect.height,
    rightGap: barRect.right - buttonRect.right,
    label: document.querySelector('#categoryToggleText')?.textContent || '',
    collapsedDisplay: getComputedStyle(document.querySelector('#categoryList')).display
  };
})()`);
assert(categoryToggleCollapsed.collapsedDisplay === "none", "Collapsed category toolbar should hide the category list");
assert(categoryToggleCollapsed.label === "Показать", "Collapsed category toolbar should offer to show categories");
for (const key of ["height", "rightGap"]) {
  assert(Math.abs(categoryToggleCollapsed[key] - categoryToggleOpen[key]) < 1, `Category toggle should stay at the right edge when collapsed (${key})`);
}
assert(categoryToggleCollapsed.left <= categoryToggleOpen.left, "Show-categories button should not move left away from the right edge");
await click("#categoryToggleButton");
await waitFor("!document.querySelector('#categoryBar').classList.contains('is-collapsed')");
const categoryToggleRestored = await evaluate(`(() => {
  const button = document.querySelector('#categoryToggleButton');
  const rect = button.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
})()`);
for (const key of ["left", "top", "width", "height"]) {
  assert(Math.abs(categoryToggleRestored[key] - categoryToggleOpen[key]) < 1, `Category toggle should return to its right-edge position (${key})`);
}
console.log("category toolbar collapse: ok");

const altCopyStarted = await evaluate(`(() => {
  const source = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === 'Ученик A');
  const target = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === 'Ученик C');
  if (!source || !target) return false;
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
  const rect = target.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
  return true;
})()`);
assert(altCopyStarted, "Alt-copy should find source and target notes");
await waitFor("Array.from(document.querySelectorAll('.note-card h3')).some((node) => node.textContent === 'Ученик A (копия)')");
const altCopyBadges = await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.note-card')).find((item) => item.querySelector('h3')?.textContent === 'Ученик A (копия)');
  return Array.from(card?.querySelectorAll('.note-category') || []).map((node) => node.textContent);
})()`);
for (const badge of ["10А", "Алгебра", "Сайт"]) {
  assert(altCopyBadges.includes(badge), `Alt-copied note should inherit target badge ${badge}`);
}
console.log("alt-drag copy to a differently categorized note: ok");

const hierarchyFileState = await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => {
  const scoped = (state.Categories || []).filter((category) => category.OwnerFolderId === hierarchyFolderId);
  const grouped = scoped.filter((category) => !category.ParentCategoryId);
  const nested = scoped.filter((category) => category.ParentCategoryId);
  const note = (state.Notes || []).find((item) => item.Title === "Ученик C");
  return grouped.length === 3 && nested.length >= 6 && note?.CategorySelections && Object.keys(note.CategorySelections).length === 3;
});
assert(hierarchyFileState.SchemaVersion >= 3, "Hierarchy data should use schema version 3 or newer");

await send("Page.reload");
await waitFor("document.querySelector('#loadingScreen') && document.querySelector('#loadingScreen').classList.contains('hide')", 12000);
await waitFor("document.querySelector('.crumb.current')?.dataset.crumb === 'root'");
await evaluate("Array.from(document.querySelectorAll('.folder-card')).find((item) => item.querySelector('h3')?.textContent === 'Иерархия')?.click(); true");
await waitFor(`document.querySelector('.crumb.current')?.dataset.crumb === ${JSON.stringify(hierarchyFolderId)}`);
await waitFor("document.querySelector('.category-chip .category-name')?.textContent === 'Класс'");
const persistedHierarchy = await evaluate(`(() => {
  const scoped = Array.from(document.querySelectorAll('.category-group'));
  return {
    firstGroup: scoped[0]?.querySelector('.category-chip .category-name')?.textContent || '',
    subcategories: Array.from(scoped[0]?.querySelectorAll('.category-subchip .category-name') || []).map((node) => node.textContent),
    subcategoryColors: Array.from(document.querySelectorAll('.category-subchip')).filter((chip) => ['10А','10Б'].includes(chip.querySelector('.category-name')?.textContent || '')).map((chip) => ({ name: chip.querySelector('.category-name')?.textContent || '', color: chip.querySelector('.category-color')?.value || '' }))
  };
})()`);
assert(persistedHierarchy.firstGroup === "Класс" && persistedHierarchy.subcategories.join(',') === "10А,10Б", "Hierarchy order and subcategories should persist after reload");
assert(persistedHierarchy.subcategoryColors.length === 2 && persistedHierarchy.subcategoryColors.find((item) => item.name === "10А")?.color.toUpperCase() === customColor, "Subcategory colors should persist after reload");
console.log("hierarchy persistence and migration-ready storage: ok");

const categoryDeleteTargets = await evaluate(`(() => {
  const group = Array.from(document.querySelectorAll('.category-chip')).find(
    (item) => item.querySelector('.category-name')?.textContent === 'Источник'
  );
  const sub = Array.from(document.querySelectorAll('.category-subchip')).find(
    (item) => item.querySelector('.category-name')?.textContent === '10Б'
  );
  if (!group || !sub) return null;
  return {
    groupId: group.dataset.categoryId,
    childIds: Array.from(group.parentElement.querySelectorAll('.category-subchip')).map((item) => item.dataset.categoryId),
    subId: sub.dataset.categoryId,
    categoryChips: document.querySelectorAll('.category-chip, .category-subchip').length,
    removeButtons: document.querySelectorAll('.category-remove').length
  };
})()`);
assert(categoryDeleteTargets, "Category delete targets should be visible");
assert(categoryDeleteTargets.removeButtons === categoryDeleteTargets.categoryChips, "Every category and subcategory should have a remove button");
await removeCategory("10Б");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => {
  const gone = !(state.Categories || []).some((category) => category.Id === categoryDeleteTargets.subId);
  const cleared = (state.Notes || []).every((note) => !Object.values(note.CategorySelections || {}).includes(categoryDeleteTargets.subId));
  return gone && cleared;
});
await removeCategory("Источник");
await waitForJsonFile("C:/sema/NotesApp/.test-data/notes.json", (state) => {
  const removedIds = new Set([categoryDeleteTargets.groupId, ...categoryDeleteTargets.childIds]);
  const gone = !(state.Categories || []).some((category) => removedIds.has(category.Id));
  const cleared = (state.Notes || []).every((note) =>
    Object.values(note.CategorySelections || {}).every((categoryId) => !removedIds.has(categoryId))
  );
  return gone && cleared;
});
console.log("category and subcategory delete: ok");

await click('[data-crumb="root"]');


const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync("C:/sema/NotesApp/preview-app.png", Buffer.from(screenshot.data, "base64"));
console.log("screenshot: preview-app.png");
console.log("E2E: PASS");
socket.close();


