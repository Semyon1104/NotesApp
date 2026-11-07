(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const MAX_IMAGE_SIDE = 1800;
  const VOICE_LANGUAGE = "ru-RU";
  const DEMO_STORAGE_KEY = "polia-demo-v1";
  const SIDEBAR_STORAGE_KEY = "pisa-nina-sidebar-collapsed";
  const CATEGORY_BAR_STORAGE_KEY = "pisa-nina-category-bar-collapsed";
  const DEFAULT_CATEGORY_COLOR = "#7D9B76";
  const CATEGORY_COLORS = ["#C9836B", "#7D9B76", "#C2A55B", "#7A8FB3", "#A57FAC", "#6FA39B"];
  const CATEGORY_MIME = "application/x-pisa-category";
  const IS_DEMO = new URLSearchParams(window.location.search).has("demo");

  const dom = {
    loading: $("#loadingScreen"),
    rootButton: $("#rootButton"),
    brandButton: $("#brandButton"),
    rootCount: $("#rootCount"),
    sidebarToggle: $("#sidebarToggle"),
    sidebarShowButton: $("#sidebarShowButton"),
    folderTree: $("#folderTree"),
    breadcrumbs: $("#breadcrumbs"),
    newNoteButton: $("#newNoteButton"),
    newFolderButton: $("#newFolderButton"),
    deleteButton: $("#deleteButton"),
    folderBackgroundButton: $("#folderBackgroundButton"),
    clearFolderBackgroundButton: $("#clearFolderBackgroundButton"),
    folderBackgroundInput: $("#folderBackgroundInput"),
    selectionCount: $("#selectionCount"),
    appShell: $(".app-shell"),
    canvas: $("#canvas"),
    grid: $("#grid"),
    emptyState: $("#emptyState"),
    emptyNewNote: $("#emptyNewNote"),
    emptyNewFolder: $("#emptyNewFolder"),
    overlay: $("#noteOverlay"),
    notePanel: $(".note-panel"),
    noteContext: $(".note-context"),
    notePlace: $("#notePlace"),
    noteDate: $("#noteDate"),
    saveNoteButton: $("#saveNoteButton"),
    voiceButton: $("#voiceButton"),
    deleteNoteButton: $("#deleteNoteButton"),
    closeNoteButton: $("#closeNoteButton"),
    noteScroll: $("#noteScroll"),
    noteView: $("#noteView"),
    noteViewTitle: $("#noteViewTitle"),
    noteViewSubtitle: $("#noteViewSubtitle"),
    noteViewContent: $("#noteViewContent"),
    noteEditorWrap: $("#noteEditorWrap"),
    noteTitleInput: $("#noteTitleInput"),
    noteSubtitleInput: $("#noteSubtitleInput"),
    noteEditor: $("#noteEditor"),
    noteFooter: $("#noteFooter"),
    formatBar: $("#formatBar"),
    insertImageButton: $("#insertImageButton"),
    imageFileInput: $("#imageFileInput"),
    saveState: $("#saveState"),
    saveStateText: $("#saveStateText"),
    dialogLayer: $("#dialogLayer"),
    dialogClose: $("#dialogClose"),
    dialogIcon: $("#dialogIcon"),
    dialogTitle: $("#dialogTitle"),
    dialogText: $("#dialogText"),
    dialogInput: $("#dialogInput"),
    dialogCancel: $("#dialogCancel"),
    dialogConfirm: $("#dialogConfirm"),
    imageResizeToolbar: $("#imageResizeToolbar"),
    imageSizeLabel: $("#imageSizeLabel"),
    imageNarrowerButton: $("#imageNarrowerButton"),
    imageWiderButton: $("#imageWiderButton"),
    imageResetButton: $("#imageResetButton"),
    imageResizeHandle: $("#imageResizeHandle"),
    toast: $("#toast"),
    voiceToast: $("#voiceToast"),
    voiceToastTitle: $("#voiceToastTitle"),
    voiceToastText: $("#voiceToastText"),
    categoryBar: $("#categoryBar"),
    categoryList: $("#categoryList"),
    newCategoryButton: $("#newCategoryButton"),
    categoryToggleButton: $("#categoryToggleButton")
  };

  let appState = { folders: [], notes: [], categories: [] };
  let currentFolderId = null;
  let openNoteId = null;
  let editing = false;
  let creatingNote = false;
  let selectedNotes = new Set();
  let selectedFolders = new Set();
  let toastTimer = null;
  let dialogResolver = null;
  let dialogOpen = false;
  let voiceSession = null;
  let voiceToastTimer = null;
  let lastEditorRange = null;
  let titleResizeFrame = null;
  let selectedEditorImage = null;
  let imageResizeDrag = null;
  let noteDragState = null;
  let folderDragState = null;
  let pendingFolderCardBackgroundId = null;
  let categoryDragState = null;
  let altHeld = false;
  let cardResizeDrag = null;
  let suppressCardClickUntil = 0;

  let pendingSave = false;
  let savePromise = Promise.resolve();
  let editorRevision = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uid() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_CATEGORY_COLOR;
  }

  function normalizeWidthSpan(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 2;
    return Math.min(8, Math.max(1, Math.round(number)));
  }

  function normalizeState(data) {
    const folderRows = (Array.isArray(data?.folders) ? data.folders : [])
      .filter((folder) => folder && folder.id)
      .map((folder) => ({
        ...folder,
        id: String(folder.id),
        parentId: folder.parentId ? String(folder.parentId) : null
      }));
    const folderIds = new Set(folderRows.map((folder) => folder.id));
    const categories = (Array.isArray(data?.categories) ? data.categories : [])
      .filter((category) => category && category.id)
      .map((category) => {
        const ownerFolderId = category.ownerFolderId ? String(category.ownerFolderId) : null;
        return {
          ...category,
          id: String(category.id),
          name: String(category.name || "Без названия").trim() || "Без названия",
          color: normalizeColor(category.color),
          ownerFolderId: ownerFolderId && folderIds.has(ownerFolderId) ? ownerFolderId : null,
          parentCategoryId: category.parentCategoryId ? String(category.parentCategoryId) : null,
          createdAt: Number(category.createdAt) || Date.now(),
          updatedAt: Number(category.updatedAt) || Date.now()
        };
      });
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    categories.forEach((category) => {
      const parent = category.parentCategoryId ? categoryById.get(category.parentCategoryId) : null;
      if (!parent
        || parent.id === category.id
        || parent.parentCategoryId
        || (parent.ownerFolderId || null) !== (category.ownerFolderId || null)) {
        category.parentCategoryId = null;
      }
    });
    const normalizeSelections = (item, ownerFolderId) => {
      const selections = {};
      const addSelection = (categoryId) => {
        if (!categoryId) return;
        const category = categoryById.get(String(categoryId));
        if (!category || (category.ownerFolderId || null) !== (ownerFolderId || null)) return;
        const groupId = category.parentCategoryId || category.id;
        if (!selections[groupId]) selections[groupId] = category.id;
      };
      if (item?.categorySelections && typeof item.categorySelections === "object") {
        Object.values(item.categorySelections).forEach(addSelection);
      }
      addSelection(item?.categoryId);
      const selectedIds = new Set(Object.values(selections));
      const legacy = categories.find(
        (category) => selectedIds.has(category.id)
          && (category.ownerFolderId || null) === (ownerFolderId || null)
      );
      return {
        categorySelections: selections,
        categoryId: legacy ? legacy.id : null
      };
    };
    const folders = folderRows.map((folder) => ({
      ...folder,
      ...normalizeSelections(folder, folder.parentId),
      widthSpan: normalizeWidthSpan(folder.widthSpan)
    }));
    const notes = (Array.isArray(data?.notes) ? data.notes : []).map((note) => ({
      ...note,
      folderId: note.folderId ? String(note.folderId) : null,
      subtitle: String(note.subtitle || "").trim(),
      ...normalizeSelections(note, note.folderId),
      widthSpan: normalizeWidthSpan(note.widthSpan)
    }));
    return { folders, notes, categories };
  }

  function categoryById(id) {
    return appState.categories.find((category) => category.id === id) || null;
  }

  function categoryBadgeColors(color) {
    const value = normalizeColor(color).slice(1);
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 255000;
    return {
      background: `#${value}`,
      color: luminance > 0.58 ? "#2D332A" : "#FFFDF7"
    };
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function errorMessage(error) {
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
    return "Что-то пошло не так. Попробуйте ещё раз.";
  }

  function pluralRu(value, one, few, many) {
    const number = Math.abs(value) % 100;
    const last = number % 10;
    if (number > 10 && number < 20) return `${value} ${many}`;
    if (last === 1) return `${value} ${one}`;
    if (last >= 2 && last <= 4) return `${value} ${few}`;
    return `${value} ${many}`;
  }

  function formatRelative(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return `сегодня, ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `вчера, ${time}`;
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" })
    });
  }

  function formatFull(timestamp) {
    return new Date(timestamp).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function folderById(id) {
    return appState.folders.find((folder) => folder.id === id) || null;
  }

  function noteById(id) {
    return appState.notes.find((note) => note.id === id) || null;
  }

  function childrenOf(parentId) {
    return appState.folders
      .filter((folder) => (folder.parentId || null) === (parentId || null))
      .sort((left, right) => left.name.localeCompare(right.name, "ru", { sensitivity: "base" }));
  }

  function getFolderTrail(folderId) {
    const trail = [];
    const visited = new Set();
    let cursor = folderId ? folderById(folderId) : null;
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      trail.unshift(cursor);
      cursor = cursor.parentId ? folderById(cursor.parentId) : null;
    }
    return trail;
  }

  function currentFolderName() {
    return currentFolderId ? (folderById(currentFolderId)?.name || "Папка") : "";
  }

  function imageCount(html) {
    return (String(html || "").match(/<img\b/gi) || []).length;
  }

  function noteSnippet(note) {
    const value = String(note.plainText || "").replace(/\s+/g, " ").trim();
    return value || "Пустая заметка";
  }

  function toneFor(id) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return (hash % 4) + 1;
  }

  function folderStats(folderId) {
    const result = { folders: 0, notes: 0 };
    const visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      result.notes += appState.notes.filter((note) => note.folderId === id).length;
      const children = childrenOf(id);
      result.folders += children.length;
      children.forEach((child) => visit(child.id));
    };
    visit(folderId);
    return result;
  }

  function folderSubtitle(folderId) {
    const stats = folderStats(folderId);
    const parts = [];
    if (stats.notes) parts.push(pluralRu(stats.notes, "заметка", "заметки", "заметок"));
    if (stats.folders) parts.push(pluralRu(stats.folders, "папка", "папки", "папок"));
    return parts.length ? parts.join(" · ") : "Пустая папка";
  }

  function sanitizeHtml(rawHtml) {
    const allowedTags = {
      P: [], BR: [], DIV: [], SPAN: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [],
      UL: [], OL: [], LI: [], BLOCKQUOTE: [], H2: [], H3: [], H4: [], HR: [],
      IMG: ["src", "alt", "style"], A: ["href"]
    };
    const blockedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT", "BUTTON", "VIDEO", "AUDIO"]);
    const template = document.createElement("template");
    template.innerHTML = String(rawHtml || "");

    const clean = (parent) => {
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) {
          node.remove();
          return;
        }
        const tag = node.tagName.toUpperCase();
        if (blockedTags.has(tag)) {
          node.remove();
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(allowedTags, tag)) {
          clean(node);
          node.replaceWith(...Array.from(node.childNodes));
          return;
        }
        Array.from(node.attributes).forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const allowed = allowedTags[tag];
          if (!allowed.includes(name)) {
            node.removeAttribute(attribute.name);
            return;
          }
          if (tag === "IMG" && name === "src") {
            const value = attribute.value.trim();
            if (!/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(value)) {
              node.removeAttribute("src");
            }
          }
          if (tag === "IMG" && name === "style") {
            const widthMatch = /^\s*width\s*:\s*(\d{1,3})%\s*;?\s*$/i.exec(attribute.value || "");
            if (!widthMatch) {
              node.removeAttribute("style");
              return;
            }
            const width = Math.max(20, Math.min(100, parseInt(widthMatch[1], 10) || 100));
            if (width >= 100) node.removeAttribute("style");
            else node.setAttribute("style", `width:${width}%`);
          }
          if (tag === "A" && name === "href") {
            const value = attribute.value.trim();
            if (!/^(https?:|mailto:)/i.test(value)) {
              node.removeAttribute("href");
            }
          }
        });
        clean(node);
      });
    };

    clean(template.content);
    return template.innerHTML;
  }

  const tauriInvoke = window.__TAURI__ && window.__TAURI__.core
    ? window.__TAURI__.core.invoke.bind(window.__TAURI__.core)
    : null;

  const webviewHost = window.chrome && window.chrome.webview ? window.chrome.webview : null;
  const desktopPending = new Map();
  let desktopRequestId = 0;

  if (webviewHost) {
    webviewHost.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || !desktopPending.has(message.id)) return;
      const pending = desktopPending.get(message.id);
      desktopPending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Ошибка приложения"));
    });
  }

  function webviewInvoke(command, args = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++desktopRequestId);
      const timer = window.setTimeout(() => {
        desktopPending.delete(id);
        reject(new Error("Приложение не ответило вовремя"));
      }, 120000);
      desktopPending.set(id, { resolve, reject, timer });
      try {
        webviewHost.postMessage({ id, command, args });
      } catch (error) {
        desktopPending.delete(id);
        window.clearTimeout(timer);
        reject(error);
      }
    });
  }

  function invoke(command, args = {}) {
    if (tauriInvoke) return tauriInvoke(command, args);
    if (webviewHost) return webviewInvoke(command, args);
    return demoInvoke(command, args);
  }

  let demoData = null;

  function seedDemo() {
    const now = Date.now();
    const diary = uid();
    const autumn = uid();
    const ideas = uid();
    return {
      folders: [
        { id: diary, name: "Дневник", parentId: null, createdAt: now - 86400000 * 9, updatedAt: now - 7200000 },
        { id: autumn, name: "Осень", parentId: diary, createdAt: now - 86400000 * 4, updatedAt: now - 3600000 },
        { id: ideas, name: "Идеи", parentId: null, createdAt: now - 86400000 * 6, updatedAt: now - 8600000 }
      ],
      categories: [],
      notes: [
        {
          id: uid(), folderId: null, title: "Медленная прогулка",
          plainText: "Дойти до старой яблони за рекой. Взять с собой термос и не смотреть на часы. Заметить, как изменился свет к вечеру.",
          contentHtml: "<p>Дойти до старой яблони за рекой. Взять с собой термос и не смотреть на часы.</p><p>Заметить, как изменился свет к вечеру, и записать пару строк на обратном пути.</p>",
          createdAt: now - 86400000 * 2, updatedAt: now - 1500000
        },
        {
          id: uid(), folderId: null, title: "Пятничный список",
          plainText: "Разобрать письма. Полить растения. Купить бумагу и хороший чай. Освободить вечер.",
          contentHtml: "<ul><li>Разобрать письма</li><li>Полить растения</li><li>Купить бумагу и хороший чай</li><li>Освободить вечер</li></ul>",
          createdAt: now - 86400000 * 3, updatedAt: now - 7400000
        },
        {
          id: uid(), folderId: diary, title: "Тихое утро",
          plainText: "Сегодня получилось проснуться до будильника. На кухне было ещё совсем темно, а на подоконнике уже шумел дождь.",
          contentHtml: "<p>Сегодня получилось проснуться до будильника. На кухне было ещё совсем темно, а на подоконнике уже шумел дождь.</p><p>Хорошее начало дня. Надо почаще оставлять телефон в другой комнате.</p>",
          createdAt: now - 86400000 * 2, updatedAt: now - 4000000
        },
        {
          id: uid(), folderId: autumn, title: "Книги на осень",
          plainText: "Собрать небольшую стопку: что-то о садах, письма и один роман, который давно ждёт.",
          contentHtml: "<p>Собрать небольшую стопку: что-то о садах, письма и один роман, который давно ждёт своей очереди.</p><blockquote>Читать медленно, без плана.</blockquote>",
          createdAt: now - 86400000, updatedAt: now - 3600000
        },
        {
          id: uid(), folderId: ideas, title: "Свет в мастерской",
          plainText: "Попробовать тёплую лампу над рабочим столом и оставить больше свободного места у окна.",
          contentHtml: "<h2>Свет</h2><p>Попробовать тёплую лампу над рабочим столом и оставить больше свободного места у окна.</p>",
          createdAt: now - 86400000 * 7, updatedAt: now - 8600000
        }
      ]
    };
  }

  function readDemoData() {
    if (demoData) return demoData;
    try {
      const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
      if (stored) demoData = JSON.parse(stored);
    } catch (_) {
      demoData = null;
    }
    if (!demoData) demoData = IS_DEMO ? seedDemo() : { folders: [], notes: [], categories: [] };
    demoData = normalizeState(demoData);
    return demoData;
  }

  function writeDemoData() {
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demoData));
    } catch (_) {
      // Browser preview can still work without persistent storage.
    }
  }

  async function demoInvoke(command, args = {}) {
    await wait(IS_DEMO ? 55 : 15);
    const data = readDemoData();

    if (command === "load_state") {
      return JSON.parse(JSON.stringify(data));
    }
    if (command === "create_folder") {
      const now = Date.now();
      const folder = {
        id: uid(), name: String(args.name || "").trim() || "Новая папка",
        parentId: args.parentId || null, categoryId: null, categorySelections: {}, widthSpan: 2,
        createdAt: now, updatedAt: now
      };
      data.folders.push(folder);
      writeDemoData();
      return folder;
    }
    if (command === "create_note") {
      const now = Date.now();
      const note = {
        id: uid(), folderId: args.folderId || null, title: "Новая заметка", subtitle: "",
        contentHtml: "", plainText: "", categoryId: null, categorySelections: {}, widthSpan: 2,
        createdAt: now, updatedAt: now
      };
      data.notes.push(note);
      writeDemoData();
      return note;
    }
    if (command === "update_note") {
      const note = data.notes.find((item) => item.id === args.id);
      if (!note) throw new Error("Заметка не найдена");
      note.title = String(args.title || "").trim() || "Без названия";
      note.subtitle = String(args.subtitle || "").trim().slice(0, 240);
      note.contentHtml = String(args.contentHtml || "");
      note.plainText = String(args.plainText || "");
      note.updatedAt = Date.now();
      writeDemoData();
      return { ...note };
    }
    if (command === "create_category") {
      const now = Date.now();
      const parent = data.categories.find(
        (item) => item.id === args.parentCategoryId && !item.parentCategoryId
      );
      const ownerFolderId = parent
        ? parent.ownerFolderId || null
        : data.folders.some((folder) => folder.id === args.ownerFolderId)
          ? args.ownerFolderId
          : null;
      const category = {
        id: uid(), name: String(args.name || "").trim() || "Новая категория",
        color: normalizeColor(args.color || (parent ? parent.color : null)), ownerFolderId,
        parentCategoryId: parent ? parent.id : null,
        createdAt: now, updatedAt: now
      };
      data.categories.push(category);
      writeDemoData();
      return category;
    }
    if (command === "update_category") {
      const category = data.categories.find((item) => item.id === args.id);
      if (!category) throw new Error("Категория не найдена");
      if (String(args.name || "").trim()) category.name = String(args.name).trim();
      if (Object.prototype.hasOwnProperty.call(args, "color")) category.color = normalizeColor(args.color);
      if (args.copyColorFromId) {
        const source = data.categories.find((item) => item.id === args.copyColorFromId
          && (item.ownerFolderId || null) === (category.ownerFolderId || null));
        if (!source) throw new Error("Нельзя взять цвет категории из другой папки");
        category.color = normalizeColor(source.color);
      }
      category.updatedAt = Date.now();
      writeDemoData();
      return { ...category };
    }
    if (command === "delete_category") {
      const category = data.categories.find((item) => item.id === args.id);
      if (!category) throw new Error("Категория не найдена");
      const removedIds = new Set([category.id]);
      if (!category.parentCategoryId) {
        data.categories.forEach((item) => {
          if (item.parentCategoryId === category.id
            && (item.ownerFolderId || null) === (category.ownerFolderId || null)) {
            removedIds.add(item.id);
          }
        });
      }
      data.categories = data.categories.filter((item) => !removedIds.has(item.id));
      [data.folders, data.notes].forEach((collection) => {
        collection.forEach((item) => {
          const selections = item.categorySelections || {};
          const filtered = Object.keys(selections).reduce((result, groupId) => {
            if (!removedIds.has(groupId) && !removedIds.has(selections[groupId])) {
              result[groupId] = selections[groupId];
            }
            return result;
          }, {});
          item.categorySelections = filtered;
          item.categoryId = Object.keys(filtered).length ? filtered[Object.keys(filtered)[0]] : null;
        });
      });
      writeDemoData();
      return { deletedIds: Array.from(removedIds) };
    }
    if (command === "reorder_categories") {
      const ownerFolderId = args.ownerFolderId || null;
      const parentCategoryId = args.parentCategoryId || null;
      const rank = new Map((args.categoryIds || []).map((id, index) => [id, index]));
      const scoped = data.categories.filter(
        (category) => (category.ownerFolderId || null) === ownerFolderId
          && (category.parentCategoryId || null) === parentCategoryId
      );
      const ordered = scoped.slice().sort((left, right) => {
        const leftRank = rank.has(left.id) ? rank.get(left.id) : Number.MAX_SAFE_INTEGER;
        const rightRank = rank.has(right.id) ? rank.get(right.id) : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
      const siblingIds = new Set(scoped.map((category) => category.id));
      let cursor = 0;
      data.categories = data.categories.map((category) =>
        siblingIds.has(category.id) ? ordered[cursor++] : category
      );
      writeDemoData();
      return data.categories.map((category) => ({ ...category }));
    }
    if (command === "set_item_category" || command === "set_note_category") {
      const kind = command === "set_note_category"
        ? "note"
        : String(args.kind || "").trim().toLowerCase();
      const itemId = command === "set_note_category" ? args.noteId : args.itemId;
      const collection = kind === "folder" ? data.folders : data.notes;
      const item = collection.find((entry) => entry.id === itemId);
      if (!item) throw new Error(kind === "folder" ? "Папка не найдена" : "Заметка не найдена");
      const ownerFolderId = kind === "folder" ? item.parentId || null : item.folderId || null;
      const category = data.categories.find(
        (entry) => entry.id === args.categoryId
          && (entry.ownerFolderId || null) === ownerFolderId
      );
      if (!category) {
        item.categoryId = null;
        item.categorySelections = {};
      } else {
        const groupId = category.parentCategoryId || category.id;
        item.categorySelections = { ...(item.categorySelections || {}), [groupId]: category.id };
        item.categoryId = category.id;
      }
      item.updatedAt = Date.now();
      writeDemoData();
      return { ...item };
    }
    if (command === "set_item_width") {
      const collection = args.kind === "folder" ? data.folders : data.notes;
      const item = collection.find((entry) => entry.id === args.itemId);
      if (!item) throw new Error("Элемент не найден");
      item.widthSpan = normalizeWidthSpan(args.widthSpan);
      writeDemoData();
      return { ...item };
    }
    if (command === "duplicate_note") {
      const index = data.notes.findIndex((item) => item.id === args.id);
      if (index < 0) throw new Error("Заметка не найдена");
      const source = data.notes[index];
      const now = Date.now();
      const target = args.targetNoteId
        ? data.notes.find((item) => item.id === args.targetNoteId && item.folderId === source.folderId)
        : null;
      const copy = {
        ...source,
        id: uid(),
        title: String((source.title || "Заметка") + " (копия)").slice(0, 120),
        categoryId: target ? target.categoryId : source.categoryId,
        categorySelections: { ...((target || source).categorySelections || {}) },
        createdAt: now,
        updatedAt: now
      };
      data.notes.splice(index + 1, 0, copy);
      writeDemoData();
      return { ...copy };
    }
    if (command === "set_folder_background") {
      const folder = data.folders.find((item) => item.id === args.folderId);
      if (!folder) throw new Error("Folder not found");
      folder.backgroundImage = String(args.backgroundImage || "");
      folder.updatedAt = Date.now();
      writeDemoData();
      return { ...folder };
    }
    if (command === "set_folder_card_background") {
      const folder = data.folders.find((item) => item.id === args.folderId);
      if (!folder) throw new Error("Folder not found");
      folder.cardBackgroundImage = String(args.backgroundImage || "");
      folder.updatedAt = Date.now();
      writeDemoData();
      return { ...folder };
    }
    if (command === "reorder_notes") {
      const rank = new Map((args.noteIds || []).map((id, index) => [id, index]));
      data.notes.sort((left, right) => {
        const leftRank = rank.has(left.id) ? rank.get(left.id) : Number.MAX_SAFE_INTEGER;
        const rightRank = rank.has(right.id) ? rank.get(right.id) : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
      writeDemoData();
      return null;
    }
    if (command === "reorder_folders") {
      const rank = new Map((args.folderIds || []).map((id, index) => [id, index]));
      data.folders.sort((left, right) => {
        const leftRank = rank.has(left.id) ? rank.get(left.id) : Number.MAX_SAFE_INTEGER;
        const rightRank = rank.has(right.id) ? rank.get(right.id) : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
      writeDemoData();
      return null;
    }
    if (command === "delete_items") {
      const folderIds = new Set(args.folderIds || []);
      let grew = true;
      while (grew) {
        grew = false;
        data.folders.forEach((folder) => {
          if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
            folderIds.add(folder.id);
            grew = true;
          }
        });
      }
      const noteIds = new Set(args.noteIds || []);
      data.folders = data.folders.filter((folder) => !folderIds.has(folder.id));
      data.notes = data.notes.filter((note) => !noteIds.has(note.id) && !folderIds.has(note.folderId));
      data.categories = data.categories.filter(
        (category) => !category.ownerFolderId || !folderIds.has(category.ownerFolderId)
      );
      const validCategories = new Map(data.categories.map((category) => [category.id, category]));
      const cleanSelections = (item, ownerFolderId) => {
        const selections = {};
        Object.values(item.categorySelections || {}).forEach((categoryId) => {
          const category = validCategories.get(categoryId);
          if (!category || (category.ownerFolderId || null) !== (ownerFolderId || null)) return;
          const groupId = category.parentCategoryId || category.id;
          if (!selections[groupId]) selections[groupId] = category.id;
        });
        item.categorySelections = selections;
        item.categoryId = Object.values(selections)[0] || null;
      };
      data.folders.forEach((folder) => cleanSelections(folder, folder.parentId || null));
      data.notes.forEach((note) => cleanSelections(note, note.folderId || null));
      writeDemoData();
      return null;
    }
    if (command === "list_speech_engines") {
      return [{ language: "en-US", name: "Microsoft Speech Recognizer 8.0 (English - US)" }];
    }
    if (command === "recognize_speech") {
      throw new Error("Голосовой ввод проверяется в настольном приложении.");
    }
    throw new Error(`Неизвестная команда: ${command}`);
  }

  function renderSidebar() {
    const rootNotes = appState.notes.filter((note) => !note.folderId).length;
    dom.rootCount.textContent = String(rootNotes);
    dom.rootButton.classList.toggle("active", !currentFolderId);

    const renderBranch = (parentId, depth) => childrenOf(parentId).map((folder) => {
      const directNotes = appState.notes.filter((note) => note.folderId === folder.id).length;
      const active = currentFolderId === folder.id ? " active" : "";
      return `<button class="tree-item${active}" type="button" data-folder-id="${escapeHtml(folder.id)}" style="--depth:${depth}" title="${escapeHtml(folder.name)}">
        <svg><use href="#i-folder"></use></svg>
        <span class="tree-name">${escapeHtml(folder.name)}</span>
        ${directNotes ? `<span class="tree-count">${directNotes}</span>` : ""}
      </button>${renderBranch(folder.id, depth + 1)}`;
    }).join("");

    dom.folderTree.innerHTML = appState.folders.length ? renderBranch(null, 0) : "";
  }

  function renderBreadcrumbs() {
    const trail = getFolderTrail(currentFolderId);
    const crumbs = [
      { id: "root", name: "", isRoot: true },
      ...trail.map((folder) => ({ id: folder.id, name: folder.name }))
    ];
    dom.breadcrumbs.innerHTML = crumbs.map((crumb, index) => {
      const isCurrent = index === crumbs.length - 1;
      const label = crumb.isRoot ? "Заметки" : escapeHtml(crumb.name);
      return `<button class="crumb${isCurrent ? " current" : ""}" type="button" data-crumb="${escapeHtml(crumb.id)}" ${isCurrent ? 'aria-current="page"' : ""} aria-label="${label}">
        ${crumb.isRoot ? '<svg><use href="#i-home"></use></svg>' : ""}
        <span>${escapeHtml(crumb.name)}</span>
      </button>${isCurrent ? "" : '<svg class="crumb-separator"><use href="#i-chevron"></use></svg>'}`;
    }).join("");
  }

  function categoriesForCurrentFolder() {
    const folderId = currentFolderId || null;
    return appState.categories.filter(
      (category) => (category.ownerFolderId || null) === folderId
    );
  }

  function categoryGroupsForCurrentFolder() {
    return categoriesForCurrentFolder().filter((category) => !category.parentCategoryId);
  }

  function subcategoriesForGroup(groupId) {
    return categoriesForCurrentFolder().filter((category) => category.parentCategoryId === groupId);
  }

  function categorySelectionForGroup(item, groupId) {
    const selectedId = item?.categorySelections?.[groupId];
    const category = categoryById(selectedId);
    return category ? category.id : null;
  }

  function categoryRankForGroup(item, group, children) {
    const selectedId = categorySelectionForGroup(item, group.id);
    if (!selectedId) return children.length + 1;
    if (selectedId === group.id) return children.length ? -1 : 0;
    const index = children.findIndex((category) => category.id === selectedId);
    return index >= 0 ? index : children.length + 1;
  }

  function compareCategoryPriority(left, right) {
    const groups = categoryGroupsForCurrentFolder();
    for (const group of groups) {
      const children = subcategoriesForGroup(group.id);
      const leftRank = categoryRankForGroup(left, group, children);
      const rightRank = categoryRankForGroup(right, group, children);
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return 0;
  }

  function orderedEntriesForCurrentFolder() {
    const folderId = currentFolderId || null;
    const entries = [
      ...appState.folders
        .map((item, index) => ({ kind: "folder", item, index }))
        .filter((entry) => (entry.item.parentId || null) === folderId),
      ...appState.notes
        .map((item, index) => ({ kind: "note", item, index }))
        .filter((entry) => (entry.item.folderId || null) === folderId)
    ];
    return entries.sort((left, right) => {
      const priority = compareCategoryPriority(left.item, right.item);
      if (priority !== 0) return priority;
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      return left.index - right.index;
    });
  }

  function orderedFoldersForCurrentFolder() {
    return orderedEntriesForCurrentFolder()
      .filter((entry) => entry.kind === "folder")
      .map((entry) => entry.item);
  }

  function orderedNotesForCurrentFolder() {
    return orderedEntriesForCurrentFolder()
      .filter((entry) => entry.kind === "note")
      .map((entry) => entry.item);
  }

  function rowStartKeyForItem(item) {
    const primaryGroup = categoryGroupsForCurrentFolder()[0];
    if (!primaryGroup) return null;
    const selectedId = categorySelectionForGroup(item, primaryGroup.id);
    return selectedId ? primaryGroup.id + ":" + selectedId : null;
  }

  function priorityStartIds() {
    const ids = new Set();
    const seen = new Set();
    orderedEntriesForCurrentFolder().forEach((entry) => {
      const key = rowStartKeyForItem(entry.item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      ids.add(entry.item.id);
    });
    return ids;
  }

  function updatePriorityStartClasses() {
    const starts = priorityStartIds();
    $$(".card", dom.grid).forEach((card) => {
      card.classList.toggle("priority-start", starts.has(card.dataset.id));
    });
  }

  function categorySelectionKey(item) {
    return categoryGroupsForCurrentFolder()
      .map((group) => group.id + ":" + (categorySelectionForGroup(item, group.id) || ""))
      .join("|");
  }

  function categoryBadgeHtml(categoryId) {
    const category = categoryById(categoryId);
    if (!category) return "";
    const colors = categoryBadgeColors(category.color);
    return '<span class="note-category" style="background:' + colors.background
      + ';color:' + colors.color + '" title="Категория: ' + escapeHtml(category.name)
      + '">' + escapeHtml(category.name) + '</span>';
  }

  function categoryBadgesHtml(item) {
    const badges = categoryGroupsForCurrentFolder()
      .map((group) => categoryBadgeHtml(categorySelectionForGroup(item, group.id)))
      .filter(Boolean)
      .join("");
    return badges ? '<div class="card-categories">' + badges + '</div>' : "";
  }

  function noteCardHtml(note, index, startNewRow = false) {
    const selected = selectedNotes.has(note.id);
    const selectionLabel = selected ? "Снять выбор" : "Выбрать заметку для удаления";
    return `<article class="card note-card tone-${toneFor(note.id)}${selected ? " selected" : ""}${startNewRow ? " priority-start" : ""}" role="button" tabindex="0" draggable="true" data-kind="note" data-id="${escapeHtml(note.id)}" style="--index:${index};--card-span:${normalizeWidthSpan(note.widthSpan)}" aria-label="${escapeHtml(note.title)}">
      <span class="card-resize-handle left" aria-hidden="true"></span>
      <span class="card-resize-handle right" aria-hidden="true"></span>
      ${categoryBadgesHtml(note)}
      <div class="note-card-main">
        <button class="select-mark" type="button" role="checkbox" aria-checked="${selected}" data-select="note" title="${selectionLabel}" aria-label="${selectionLabel}: ${escapeHtml(note.title)}">
          <svg><use href="#i-trash"></use></svg>
        </button>
        <h3 title="${escapeHtml(note.title)}">${escapeHtml(note.title)}</h3>
      </div>
    </article>`;
  }

  function folderCardHtml(folder, index, startNewRow = false) {
    const selected = selectedFolders.has(folder.id);
    const cardBackground = folderCardBackgroundSource(folder);
    const hasCardBackground = Boolean(cardBackground);
    const coverLabel = hasCardBackground ? "Заменить фото на карточке папки" : "Добавить фото на карточку папки";
    const cardStyle = `--index:${index};--card-span:${normalizeWidthSpan(folder.widthSpan)}`
      + (cardBackground ? `;--folder-card-background:url('${escapeHtml(cardBackground)}')` : "");
    return `<article class="card folder-card${selected ? " selected" : ""}${startNewRow ? " priority-start" : ""}${hasCardBackground ? " has-card-background" : ""}" role="button" tabindex="0" draggable="true" data-kind="folder" data-id="${escapeHtml(folder.id)}" style="${cardStyle}" aria-label="Папка ${escapeHtml(folder.name)}">
      <span class="card-resize-handle left" aria-hidden="true"></span>
      <span class="card-resize-handle right" aria-hidden="true"></span>
      <button class="select-mark" type="button" role="checkbox" aria-checked="${selected}" data-select="folder" title="Выбрать папку">
        <svg><use href="#i-check"></use></svg>
      </button>
      ${categoryBadgesHtml(folder)}
      <div class="folder-card-head">
        <span class="card-icon"><svg><use href="#i-folder"></use></svg></span>
        <button class="folder-cover-button${hasCardBackground ? " has-card-background" : ""}" type="button" data-folder-card-background="${escapeHtml(folder.id)}" draggable="false" title="${coverLabel}" aria-label="${coverLabel}" aria-pressed="${hasCardBackground}">
          <svg><use href="#i-image"></use></svg>
        </button>
        ${hasCardBackground ? `<button class="folder-cover-clear" type="button" data-folder-card-background-clear="${escapeHtml(folder.id)}" draggable="false" title="Убрать фото с карточки папки" aria-label="Убрать фото с карточки папки"><svg><use href="#i-x"></use></svg></button>` : ""}
      </div>
      <h3>${escapeHtml(folder.name)}</h3>
      <p>${escapeHtml(folderSubtitle(folder.id))}</p>
      <footer class="card-footer">
        <span>${formatRelative(folder.updatedAt)}</span>
      </footer>
    </article>`;
  }

  function captureNoteCardPositions() {
    const positions = new Map();
    $$(".card", dom.grid).forEach((card) => {
      positions.set(card.dataset.id, card.getBoundingClientRect());
    });
    return positions;
  }

  function animateNoteCardsFrom(positions) {
    window.requestAnimationFrame(() => {
      $$(".card", dom.grid).forEach((card) => {
        const before = positions.get(card.dataset.id);
        if (!before) return;
        const after = card.getBoundingClientRect();
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
        card.classList.add("is-reordering");
        const animation = card.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: "translate(0, 0)" }
          ],
          { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
        );
        animation.addEventListener("finish", () => card.classList.remove("is-reordering"), { once: true });
      });
    });
  }

  function renderCategoryBar() {
    if (!dom.categoryList) return;
    const groups = categoryGroupsForCurrentFolder();
    if (!groups.length) {
      const emptyText = currentFolderId ? "Нет категорий в этой папке" : "Нет категорий";
      dom.categoryList.innerHTML = `<span class="category-empty">${emptyText}</span>`;
      return;
    }
    dom.categoryList.innerHTML = groups.map((group, index) => {
      const children = subcategoriesForGroup(group.id);
      const childHtml = children.map((category) => `
        <div class="category-subchip" draggable="true" data-category-id="${escapeHtml(category.id)}" data-parent-category-id="${escapeHtml(group.id)}" style="--category-color:${normalizeColor(category.color)}" title="Подкатегория; перетащите на карточку">
          <input class="category-color" type="color" value="${normalizeColor(category.color)}" data-category-color="${escapeHtml(category.id)}" draggable="false" aria-label="Цвет подкатегории ${escapeHtml(category.name)}" />
          <span class="category-name">${escapeHtml(category.name)}</span>
          <button class="category-rename" type="button" data-rename-category="${escapeHtml(category.id)}" draggable="false" title="Переименовать подкатегорию" aria-label="Переименовать подкатегорию ${escapeHtml(category.name)}"><svg><use href="#i-pencil"></use></svg></button>
          <button class="category-remove" type="button" data-remove-category="${escapeHtml(category.id)}" draggable="false" title="Удалить подкатегорию" aria-label="Удалить подкатегорию ${escapeHtml(category.name)}"><svg><use href="#i-x"></use></svg></button>
        </div>
      `).join("");
      return `
        <div class="category-group" data-group-id="${escapeHtml(group.id)}">
          <div class="category-chip" draggable="true" data-category-id="${escapeHtml(group.id)}" data-parent-category-id="" style="--category-color:${normalizeColor(group.color)}" title="Главная категория ${index + 1}; перетащите на карточку">
            <span class="category-rank" aria-hidden="true">${index + 1}</span>
            <input class="category-color" type="color" value="${normalizeColor(group.color)}" data-category-color="${escapeHtml(group.id)}" draggable="false" aria-label="Цвет категории ${escapeHtml(group.name)}" />
            <span class="category-name">${escapeHtml(group.name)}</span>
            <button class="category-rename" type="button" data-rename-category="${escapeHtml(group.id)}" draggable="false" title="Переименовать категорию" aria-label="Переименовать категорию ${escapeHtml(group.name)}"><svg><use href="#i-pencil"></use></svg></button>
            <button class="category-subadd" type="button" data-add-subcategory="${escapeHtml(group.id)}" draggable="false" title="Добавить подкатегорию">+</button>
            <button class="category-remove" type="button" data-remove-category="${escapeHtml(group.id)}" draggable="false" title="Удалить категорию" aria-label="Удалить категорию ${escapeHtml(group.name)}"><svg><use href="#i-x"></use></svg></button>
          </div>
          ${childHtml ? `<div class="category-subs">${childHtml}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  function renderCanvas(options = {}) {
    const previousPositions = options.animate ? captureNoteCardPositions() : null;
    const entries = orderedEntriesForCurrentFolder();
    const starts = priorityStartIds();
    const total = entries.length;
    const cards = entries.map((entry, index) => entry.kind === "folder"
      ? folderCardHtml(entry.item, index, starts.has(entry.item.id))
      : noteCardHtml(entry.item, index, starts.has(entry.item.id)));
    dom.grid.classList.toggle("settled", Boolean(options.animate));
    dom.grid.innerHTML = cards.join("");
    dom.grid.hidden = total === 0;
    dom.emptyState.hidden = total !== 0;
    applyFolderBackground();
    if (previousPositions) animateNoteCardsFrom(previousPositions);
  }

  function applySidebarCollapsed(collapsed, persist = true) {
    dom.appShell.classList.toggle("sidebar-collapsed", collapsed);
    const label = collapsed ? "Показать панель" : "Скрыть панель";
    dom.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    dom.sidebarToggle.setAttribute("aria-label", label);
    dom.sidebarToggle.title = label;
    dom.sidebarShowButton.setAttribute("aria-expanded", String(!collapsed));
    if (persist) {
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
      } catch (_) {
        // The preference is non-critical; the panel still works for this run.
      }
    }
  }

  function readSidebarPreference() {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function applyCategoryBarCollapsed(collapsed, persist = true) {
    if (!dom.categoryBar || !dom.categoryToggleButton) return;
    dom.categoryBar.classList.toggle("is-collapsed", collapsed);
    dom.categoryToggleButton.setAttribute("aria-expanded", String(!collapsed));
    dom.categoryToggleButton.title = collapsed ? "Показать категории" : "Скрыть категории";
    dom.categoryToggleButton.setAttribute("aria-label", dom.categoryToggleButton.title);
    const label = $("#categoryToggleText", dom.categoryToggleButton);
    if (label) label.textContent = collapsed ? "Показать" : "Скрыть";
    if (persist) {
      try {
        window.localStorage.setItem(CATEGORY_BAR_STORAGE_KEY, collapsed ? "1" : "0");
      } catch (_) {
        // The preference is non-critical; the panel still works for this run.
      }
    }
  }

  function readCategoryBarPreference() {
    try {
      return window.localStorage.getItem(CATEGORY_BAR_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function renderAll() {
    if (currentFolderId && !folderById(currentFolderId)) currentFolderId = null;
    renderSidebar();
    renderBreadcrumbs();
    renderCategoryBar();
    renderCanvas();
    updateDeleteButton();
    updateFolderBackgroundControls();
  }

  function updateDeleteButton() {
    const count = selectedNotes.size + selectedFolders.size;
    dom.deleteButton.disabled = count === 0;
    dom.selectionCount.textContent = String(count);
    dom.selectionCount.classList.toggle("visible", count > 0);
    dom.deleteButton.title = count
      ? `Удалить выбранное (${pluralRu(count, "элемент", "элемента", "элементов")})`
      : "Удалить выбранное";
  }

  function clearSelection() {
    selectedNotes.clear();
    selectedFolders.clear();
    $$(".card.selected", dom.grid).forEach((card) => {
      card.classList.remove("selected");
      const mark = $(".select-mark", card);
      if (mark) mark.setAttribute("aria-checked", "false");
    });
    updateDeleteButton();
  }

  function toggleSelection(kind, id, card) {
    const set = kind === "note" ? selectedNotes : selectedFolders;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const isSelected = set.has(id);
    if (card) {
      card.classList.toggle("selected", isSelected);
      const mark = $(".select-mark", card);
      if (mark) mark.setAttribute("aria-checked", String(isSelected));
    }
    updateDeleteButton();
  }

  function showToast(message, type = "") {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("error", type === "error");
    dom.toast.classList.add("show");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 3400);
  }

  function openDialog(options = {}) {
    if (dialogResolver) finishDialog(null);
    const {
      title = "Новая папка",
      text = "",
      input = false,
      value = "",
      placeholder = "",
      confirmLabel = "Создать",
      danger = false,
      icon = "folder-plus"
    } = options;

    return new Promise((resolve) => {
      dialogResolver = resolve;
      dialogOpen = true;
      dom.dialogLayer.classList.add("open");
      dom.dialogLayer.setAttribute("aria-hidden", "false");
      dom.dialogTitle.textContent = title;
      dom.dialogText.textContent = text;
      dom.dialogText.hidden = !text;
      dom.dialogInput.hidden = !input;
      dom.dialogInput.value = value;
      dom.dialogInput.placeholder = placeholder;
      dom.dialogConfirm.textContent = confirmLabel;
      dom.dialogConfirm.classList.toggle("danger", danger);
      dom.dialogConfirm.classList.toggle("btn-primary", true);
      dom.dialogIcon.classList.toggle("danger", danger);
      dom.dialogIcon.innerHTML = `<svg><use href="#i-${icon}"></use></svg>`;
      window.setTimeout(() => {
        if (input) {
          dom.dialogInput.focus();
          dom.dialogInput.select();
        } else {
          dom.dialogConfirm.focus();
        }
      }, 40);
    });
  }

  function finishDialog(result) {
    if (!dialogOpen) return;
    const resolve = dialogResolver;
    dialogResolver = null;
    dialogOpen = false;
    dom.dialogLayer.classList.remove("open");
    dom.dialogLayer.setAttribute("aria-hidden", "true");
    if (resolve) resolve(result);
  }

  function confirmDialogInput() {
    const needsInput = !dom.dialogInput.hidden;
    if (needsInput) {
      const value = dom.dialogInput.value.trim();
      if (!value) {
        dom.dialogInput.focus();
        dom.dialogInput.style.borderColor = "rgba(163, 100, 84, 0.7)";
        window.setTimeout(() => { dom.dialogInput.style.borderColor = ""; }, 1000);
        return;
      }
      finishDialog(value);
      return;
    }
    finishDialog(true);
  }

  async function beginCreateNote() {
    if (creatingNote) return;
    creatingNote = true;
    dom.newNoteButton.disabled = true;
    dom.emptyNewNote.disabled = true;
    try {
      const note = await invoke("create_note", { folderId: currentFolderId });
      appState.notes.push(note);
      renderAll();
      await openNote(note.id, true);
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      creatingNote = false;
      dom.newNoteButton.disabled = false;
      dom.emptyNewNote.disabled = false;
    }
  }

  async function beginCreateFolder() {
    const name = await openDialog({
      title: "Новая папка",
      text: currentFolderId ? `Папка внутри «${currentFolderName()}»` : "",
      input: true,
      placeholder: "Например, «Идеи»",
      confirmLabel: "Создать",
      icon: "folder-plus"
    });
    if (!name) return;
    try {
      const folder = await invoke("create_folder", { name, parentId: currentFolderId });
      appState.folders.push(folder);
      renderAll();
      showToast("Папка создана");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function beginCreateCategory(parentCategoryId = null) {
    const parent = parentCategoryId ? categoryById(parentCategoryId) : null;
    const name = await openDialog({
      title: parent ? "Новая подкатегория" : "Новая категория",
      text: parent
        ? "Внутри «" + parent.name + "». Цвет можно изменить или скопировать у другой подкатегории."
        : "Цвет можно изменить на цветной плашке в панели категорий.",
      input: true,
      placeholder: parent ? "Например, «10 класс»" : "Например, «Класс»",
      confirmLabel: "Создать",
      icon: "tag"
    });
    if (!name) return;
    const ownerFolderId = currentFolderId || null;
    const siblings = parent
      ? subcategoriesForGroup(parent.id)
      : categoryGroupsForCurrentFolder();
    const color = CATEGORY_COLORS[siblings.length % CATEGORY_COLORS.length];
    try {
      const created = await invoke("create_category", {
        name,
        color,
        ownerFolderId,
        parentCategoryId: parent ? parent.id : null
      });
      appState.categories.push({
        ...created,
        color: normalizeColor(created.color),
        ownerFolderId: created.ownerFolderId || null,
        parentCategoryId: created.parentCategoryId || null
      });
      applyCategoryBarCollapsed(false);
      renderCategoryBar();
      renderCanvas({ animate: true });
      showToast(parent ? "Подкатегория создана" : "Категория создана");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function beginRenameCategory(categoryId) {
    const category = categoryById(categoryId);
    if (!category) return;
    const isSubcategory = Boolean(category.parentCategoryId);
    const name = await openDialog({
      title: isSubcategory ? "Переименовать подкатегорию" : "Переименовать категорию",
      text: "Новое имя сразу обновится на всех карточках.",
      input: true,
      value: category.name,
      placeholder: category.name,
      confirmLabel: "Сохранить",
      icon: "pencil"
    });
    if (!name || name === category.name) return;
    const previousName = category.name;
    category.name = name;
    renderCategoryBar();
    renderCanvas({ animate: true });
    try {
      const updated = await invoke("update_category", { id: category.id, name: category.name });
      category.name = String(updated.name || category.name).trim() || category.name;
      category.updatedAt = updated.updatedAt;
      renderCategoryBar();
      renderCanvas({ animate: true });
      showToast(isSubcategory ? "Подкатегория переименована" : "Категория переименована");
    } catch (error) {
      category.name = previousName;
      renderCategoryBar();
      renderCanvas({ animate: true });
      showToast(errorMessage(error), "error");
    }
  }

  async function updateCategoryColor(categoryId, color) {
    const category = categoryById(categoryId);
    if (!category) return;
    const previous = category.color;
    category.color = normalizeColor(color);
    renderCategoryBar();
    renderCanvas({ animate: true });
    try {
      const updated = await invoke("update_category", {
        id: category.id,
        name: category.name,
        color: category.color
      });
      category.color = normalizeColor(updated.color);
      category.updatedAt = updated.updatedAt;
    } catch (error) {
      category.color = previous;
      renderCategoryBar();
      renderCanvas({ animate: true });
      showToast(errorMessage(error), "error");
    }
  }

  async function beginDeleteCategory(categoryId) {
    const category = categoryById(categoryId);
    if (!category) return;
    const children = category.parentCategoryId ? [] : subcategoriesForGroup(category.id);
    const childNames = children.map((item) => "«" + item.name + "»").join(", ");
    const detail = children.length
      ? "Вместе с ней удалятся подкатегории: " + childNames + ". "
      : "";
    const confirmed = await openDialog({
      title: category.parentCategoryId ? "Удалить подкатегорию?" : "Удалить категорию?",
      text: detail + "Она также исчезнет с карточек заметок и папок.",
      confirmLabel: "Удалить",
      danger: true,
      icon: "trash"
    });
    if (!confirmed) return;
    try {
      await invoke("delete_category", { id: category.id });
      await reloadState();
      showToast(category.parentCategoryId ? "Подкатегория удалена" : "Категория удалена");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  function folderBackgroundSource(folder) {
    const value = String(folder && folder.backgroundImage || "");
    return /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(value) ? value : "";
  }

  function folderCardBackgroundSource(folder) {
    const value = String(folder && folder.cardBackgroundImage || "");
    return /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(value) ? value : "";
  }

  function applyFolderBackground() {
    const folder = currentFolderId ? folderById(currentFolderId) : null;
    const source = folderBackgroundSource(folder);
    dom.canvas.classList.toggle("has-folder-background", Boolean(source));
    if (source) dom.canvas.style.setProperty("--folder-background", `url("${source}")`);
    else dom.canvas.style.removeProperty("--folder-background");
  }

  function updateFolderBackgroundControls() {
    const folder = currentFolderId ? folderById(currentFolderId) : null;
    const hasBackground = Boolean(folderBackgroundSource(folder));
    dom.folderBackgroundButton.hidden = !folder;
    dom.clearFolderBackgroundButton.hidden = !folder || !hasBackground;
    dom.folderBackgroundButton.title = hasBackground ? "Заменить фон папки" : "Добавить фон папки";
    dom.folderBackgroundButton.setAttribute("aria-label", hasBackground ? "Заменить фон папки" : "Добавить фон папки");
  }

  async function setFolderBackground(folderId, source) {
    const updated = await invoke("set_folder_background", { folderId, backgroundImage: source || "" });
    const index = appState.folders.findIndex((folder) => folder.id === folderId);
    if (index >= 0) appState.folders[index] = updated;
    applyFolderBackground();
    updateFolderBackgroundControls();
    return updated;
  }

  async function handleFolderBackgroundFile(file) {
    if (!file || !currentFolderId) return;
    if (!/^image\//i.test(file.type)) {
      showToast("Выберите файл изображения", "error");
      return;
    }
    try {
      dom.folderBackgroundButton.disabled = true;
      const source = await optimizeImage(file);
      if (!folderById(currentFolderId)) return;
      await setFolderBackground(currentFolderId, source);
      showToast("Фон папки обновлён");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      dom.folderBackgroundButton.disabled = false;
    }
  }

  async function setFolderCardBackground(folderId, source) {
    const updated = await invoke("set_folder_card_background", {
      folderId,
      backgroundImage: source || ""
    });
    const index = appState.folders.findIndex((folder) => folder.id === folderId);
    if (index >= 0) appState.folders[index] = updated;
    renderCanvas();
    return updated;
  }

  async function handleFolderCardBackgroundFile(file) {
    const folderId = pendingFolderCardBackgroundId;
    pendingFolderCardBackgroundId = null;
    if (!file || !folderId) return;
    if (!/^image\//i.test(file.type)) {
      showToast("Выберите файл изображения", "error");
      return;
    }
    try {
      dom.folderBackgroundButton.disabled = true;
      const source = await optimizeImage(file);
      if (!folderById(folderId)) return;
      await setFolderCardBackground(folderId, source);
      showToast("Фото на карточке папки обновлено");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      dom.folderBackgroundButton.disabled = false;
    }
  }

  async function clearFolderCardBackground(folderId) {
    if (!folderById(folderId)) return;
    try {
      await setFolderCardBackground(folderId, "");
      showToast("Фото с карточки папки убрано");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function clearFolderBackground() {
    if (!currentFolderId) return;
    const folderId = currentFolderId;
    try {
      dom.clearFolderBackgroundButton.disabled = true;
      await setFolderBackground(folderId, "");
      showToast("Фон папки убран");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      dom.clearFolderBackgroundButton.disabled = false;
    }
  }

  function gridTrackMetrics() {
    const computed = getComputedStyle(dom.grid);
    const tracks = computed.gridTemplateColumns
      .split(/\s+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const gap = Number.parseFloat(computed.columnGap) || 17;
    return {
      track: tracks[0] || 100,
      gap,
      maxSpan: Math.max(1, Math.min(8, tracks.length || 8))
    };
  }

  function beginCardResize(event, card, side) {
    if (event.button !== 0 || !card) return;
    event.preventDefault();
    event.stopPropagation();
    const metrics = gridTrackMetrics();
    cardResizeDrag = {
      card,
      id: card.dataset.id,
      kind: card.dataset.kind,
      side,
      startX: event.clientX,
      startWidth: card.getBoundingClientRect().width,
      startSpan: normalizeWidthSpan(card.style.getPropertyValue("--card-span")),
      span: normalizeWidthSpan(card.style.getPropertyValue("--card-span")),
      ...metrics
    };
    card.classList.add("is-resizing");
    document.body.classList.add("is-resizing-cards");
    suppressCardClickUntil = Date.now() + 500;
  }

  function moveCardResize(event) {
    if (!cardResizeDrag) return;
    event.preventDefault();
    const delta = event.clientX - cardResizeDrag.startX;
    const targetWidth = cardResizeDrag.side === "right"
      ? cardResizeDrag.startWidth + delta
      : cardResizeDrag.startWidth - delta;
    const rawSpan = (targetWidth + cardResizeDrag.gap) / (cardResizeDrag.track + cardResizeDrag.gap);
    const span = Math.min(cardResizeDrag.maxSpan, Math.max(1, Math.round(rawSpan)));
    if (span === cardResizeDrag.span) return;
    cardResizeDrag.span = span;
    cardResizeDrag.card.style.setProperty("--card-span", String(span));
  }

  async function finishCardResize(cancelled = false) {
    if (!cardResizeDrag) return;
    const state = cardResizeDrag;
    cardResizeDrag = null;
    state.card.classList.remove("is-resizing");
    document.body.classList.remove("is-resizing-cards");
    suppressCardClickUntil = Date.now() + 350;
    if (cancelled) {
      state.card.style.setProperty("--card-span", String(state.startSpan));
      return;
    }
    const collection = state.kind === "folder" ? appState.folders : appState.notes;
    const item = collection.find((entry) => entry.id === state.id);
    if (!item) return;
    item.widthSpan = state.span;
    if (state.span === state.startSpan) return;
    try {
      await invoke("set_item_width", {
        kind: state.kind,
        itemId: state.id,
        widthSpan: state.span
      });
    } catch (error) {
      item.widthSpan = state.startSpan;
      state.card.style.setProperty("--card-span", String(state.startSpan));
      showToast(errorMessage(error), "error");
    }
  }

  function clearNoteDropMarkers() {
    $$(".card.drop-before, .card.drop-after, .card.category-drop-target", dom.grid).forEach((card) => {
      card.classList.remove("drop-before", "drop-after", "category-drop-target");
      card.style.removeProperty("--category-drop-color");
    });
  }

  function reorderNotes(draggedId, targetId, placeAfter) {
    const folderId = currentFolderId || null;
    const dragged = noteById(draggedId);
    const target = noteById(targetId);
    if (!dragged || !target) return null;
    if ((dragged.folderId || null) !== folderId || (target.folderId || null) !== folderId) return null;
    const selectionKey = categorySelectionKey(dragged);
    if (selectionKey !== categorySelectionKey(target)) return null;
    const group = appState.notes.filter((note) => (note.folderId || null) === folderId
      && categorySelectionKey(note) === selectionKey);
    const ordered = group.filter((note) => note.id !== draggedId);
    let targetIndex = ordered.findIndex((note) => note.id === targetId);
    if (targetIndex < 0) return null;
    if (placeAfter) targetIndex += 1;
    ordered.splice(targetIndex, 0, dragged);
    const groupIds = new Set(group.map((note) => note.id));
    let cursor = 0;
    appState.notes = appState.notes.map((note) => groupIds.has(note.id) ? ordered[cursor++] : note);
    return { notes: ordered, selectionKey };
  }

  function orderedNoteIdsForCurrentFolder() {
    return orderedNotesForCurrentFolder().map((note) => note.id);
  }

  function orderedFolderIdsForCurrentFolder() {
    return orderedFoldersForCurrentFolder().map((folder) => folder.id);
  }

  function reorderFolders(draggedId, targetId, placeAfter) {
    const parentId = currentFolderId || null;
    const dragged = folderById(draggedId);
    const target = folderById(targetId);
    if (!dragged || !target) return null;
    if ((dragged.parentId || null) !== parentId || (target.parentId || null) !== parentId) return null;
    const selectionKey = categorySelectionKey(dragged);
    if (selectionKey !== categorySelectionKey(target)) return null;
    const group = appState.folders.filter((folder) => (folder.parentId || null) === parentId
      && categorySelectionKey(folder) === selectionKey);
    const ordered = group.filter((folder) => folder.id !== draggedId);
    let targetIndex = ordered.findIndex((folder) => folder.id === targetId);
    if (targetIndex < 0) return null;
    if (placeAfter) targetIndex += 1;
    ordered.splice(targetIndex, 0, dragged);
    const groupIds = new Set(group.map((folder) => folder.id));
    let cursor = 0;
    appState.folders = appState.folders.map(
      (folder) => groupIds.has(folder.id) ? ordered[cursor++] : folder
    );
    return { folders: ordered };
  }

  function finishFolderDrag() {
    if (!folderDragState) return;
    const draggedId = folderDragState.id;
    folderDragState = null;
    clearNoteDropMarkers();
    const card = dom.grid.querySelector(
      `.folder-card[data-id="${CSS.escape(draggedId)}"]`
    );
    if (card) card.classList.remove("dragging");
  }

  async function dropFolderCard(event) {
    if (!folderDragState) return;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest(".folder-card") : null;
    const draggedId = folderDragState.id;
    const targetId = target ? target.dataset.id : null;
    const placeAfter = Boolean(target && folderDragState.placeAfter);
    finishFolderDrag();
    if (!targetId || targetId === draggedId) return;
    const positions = captureNoteCardPositions();
    const result = reorderFolders(draggedId, targetId, placeAfter);
    if (!result) return;
    const draggedCard = dom.grid.querySelector(
      `.folder-card[data-id="${CSS.escape(draggedId)}"]`
    );
    const targetCard = dom.grid.querySelector(
      `.folder-card[data-id="${CSS.escape(targetId)}"]`
    );
    if (!insertCardNearTarget(draggedCard, targetCard, placeAfter)) {
      renderCanvas({ animate: true });
    } else {
      updatePriorityStartClasses();
      animateNoteCardsFrom(positions);
    }
    try {
      await invoke("reorder_folders", { folderIds: orderedFolderIdsForCurrentFolder() });
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
    }
  }

  function finishNoteDrag() {
    if (!noteDragState) return;
    const draggedId = noteDragState.id;
    noteDragState = null;
    clearNoteDropMarkers();
    const card = dom.grid.querySelector(`.note-card[data-id="${CSS.escape(draggedId)}"]`);
    if (card) card.classList.remove("dragging", "is-copy-dragging");
    document.body.classList.remove("is-copy-dragging");
  }

  function insertCardNearTarget(card, targetCard, placeAfter) {
    if (!card || !targetCard || !targetCard.parentNode) return false;
    if (placeAfter) targetCard.after(card);
    else targetCard.before(card);
    return true;
  }

  async function copyNoteAtTarget(draggedId, targetId, placeAfter) {
    const target = noteById(targetId);
    if (!target) return;
    const targetCard = dom.grid.querySelector(`.note-card[data-id="${CSS.escape(targetId)}"]`);
    if (!targetCard) return;
    const positions = captureNoteCardPositions();
    try {
      const created = await invoke("duplicate_note", { id: draggedId, targetNoteId: targetId });
      const copy = {
        ...created,
        categoryId: created.categoryId || target.categoryId || null,
        categorySelections: {
          ...((created.categorySelections || target.categorySelections || {}))
        },
        widthSpan: normalizeWidthSpan(created.widthSpan)
      };
      const targetIndex = appState.notes.findIndex((note) => note.id === targetId);
      appState.notes.splice(targetIndex + (placeAfter ? 1 : 0), 0, copy);
      const template = document.createElement("template");
      template.innerHTML = noteCardHtml(copy, 0).trim();
      const card = template.content.firstElementChild;
      insertCardNearTarget(card, targetCard, placeAfter);
      updatePriorityStartClasses();
      animateNoteCardsFrom(positions);
      await invoke("reorder_notes", { noteIds: orderedNoteIdsForCurrentFolder() });
      showToast("Создана копия заметки");
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
    }
  }

  function insertCardInPriorityOrder(card, itemId) {
    const entries = orderedEntriesForCurrentFolder();
    const index = entries.findIndex((entry) => entry.item.id === itemId);
    if (index < 0) {
      dom.grid.appendChild(card);
      return;
    }
    for (let cursor = index + 1; cursor < entries.length; cursor++) {
      const nextCard = dom.grid.querySelector(
        `.card[data-id="${CSS.escape(entries[cursor].item.id)}"]`
      );
      if (nextCard) {
        nextCard.before(card);
        return;
      }
    }
    dom.grid.appendChild(card);
  }

  async function copyNoteAtEnd(draggedId) {
    const source = noteById(draggedId);
    if (!source) return;
    const positions = captureNoteCardPositions();
    try {
      const created = await invoke("duplicate_note", { id: draggedId });
      const copy = {
        ...created,
        categoryId: created.categoryId || source.categoryId || null,
        categorySelections: {
          ...((created.categorySelections || source.categorySelections || {}))
        },
        widthSpan: normalizeWidthSpan(created.widthSpan)
      };
      appState.notes.push(copy);
      const template = document.createElement("template");
      template.innerHTML = noteCardHtml(copy, 0).trim();
      const card = template.content.firstElementChild;
      insertCardInPriorityOrder(card, copy.id);
      updatePriorityStartClasses();
      animateNoteCardsFrom(positions);
      await invoke("reorder_notes", { noteIds: orderedNoteIdsForCurrentFolder() });
      showToast("Создана копия заметки");
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
    }
  }

  async function dropNoteCard(event) {
    if (!noteDragState) return;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest(".note-card") : null;
    const draggedId = noteDragState.id;
    const targetId = target ? target.dataset.id : null;
    const placeAfter = Boolean(target && noteDragState.placeAfter);
    const isCopy = noteDragState.isCopy || altHeld || event.altKey;
    finishNoteDrag();
    if (!targetId) {
      if (isCopy) await copyNoteAtEnd(draggedId);
      return;
    }
    if (targetId === draggedId) return;
    if (isCopy) {
      await copyNoteAtTarget(draggedId, targetId, placeAfter);
      return;
    }
    const positions = captureNoteCardPositions();
    const result = reorderNotes(draggedId, targetId, placeAfter);
    if (!result) return;
    const draggedCard = dom.grid.querySelector(`.note-card[data-id="${CSS.escape(draggedId)}"]`);
    const targetCard = dom.grid.querySelector(`.note-card[data-id="${CSS.escape(targetId)}"]`);
    if (!insertCardNearTarget(draggedCard, targetCard, placeAfter)) {
      renderCanvas({ animate: true });
    } else {
      updatePriorityStartClasses();
      animateNoteCardsFrom(positions);
    }
    try {
      await invoke("reorder_notes", { noteIds: result.notes.map((note) => note.id) });
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
    }
  }

  function clearCategoryDropMarkers() {
    $$(".category-chip.drop-before, .category-chip.drop-after, .category-subchip.drop-before, .category-subchip.drop-after", dom.categoryList).forEach((chip) => {
      chip.classList.remove("drop-before", "drop-after");
    });
  }

  function finishCategoryDrag() {
    const state = categoryDragState;
    categoryDragState = null;
    clearCategoryDropMarkers();
    if (!state) return;
    const chip = dom.categoryList.querySelector(
      `.category-chip[data-category-id="${CSS.escape(state.id)}"], .category-subchip[data-category-id="${CSS.escape(state.id)}"]`
    );
    if (chip) chip.classList.remove("dragging");
  }

  async function reorderCategory(draggedId, targetId, placeAfter) {
    const ownerFolderId = currentFolderId || null;
    const dragged = categoryById(draggedId);
    const target = categoryById(targetId);
    if (!dragged || !target) return false;
    const parentCategoryId = dragged.parentCategoryId || null;
    if ((dragged.ownerFolderId || null) !== ownerFolderId
      || (target.ownerFolderId || null) !== ownerFolderId
      || (target.parentCategoryId || null) !== parentCategoryId) return false;
    const siblings = categoriesForCurrentFolder().filter(
      (category) => (category.parentCategoryId || null) === parentCategoryId
    );
    const ordered = siblings.filter((category) => category.id !== draggedId);
    let targetIndex = ordered.findIndex((category) => category.id === targetId);
    if (targetIndex < 0) return false;
    if (placeAfter) targetIndex += 1;
    ordered.splice(targetIndex, 0, dragged);
    const siblingIds = new Set(siblings.map((category) => category.id));
    let cursor = 0;
    appState.categories = appState.categories.map((category) =>
      siblingIds.has(category.id) ? ordered[cursor++] : category
    );
    renderCategoryBar();
    renderCanvas({ animate: true });
    try {
      await invoke("reorder_categories", {
        categoryIds: ordered.map((category) => category.id),
        ownerFolderId,
        parentCategoryId
      });
      return true;
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
      return false;
    }
  }

  async function dropCategoryOnCard(event) {
    if (!categoryDragState) return;
    const card = event.target instanceof Element ? event.target.closest(".card") : null;
    if (!card) return;
    event.preventDefault();
    const category = categoryById(categoryDragState.id);
    const kind = card.dataset.kind;
    const item = kind === "folder" ? folderById(card.dataset.id) : noteById(card.dataset.id);
    finishCategoryDrag();
    const ownerFolderId = kind === "folder"
      ? (item ? item.parentId || null : null)
      : (item ? item.folderId || null : null);
    if (!category || !item || (category.ownerFolderId || null) !== ownerFolderId) return;
    const groupId = category.parentCategoryId || category.id;
    if (item.categorySelections?.[groupId] === category.id) return;
    item.categorySelections = {
      ...(item.categorySelections || {}),
      [groupId]: category.id
    };
    item.categoryId = category.id;
    clearNoteDropMarkers();
    renderCanvas({ animate: true });
    try {
      await invoke("set_item_category", {
        kind,
        itemId: item.id,
        categoryId: category.id
      });
      showToast("Категория «" + category.name + "» назначена");
    } catch (error) {
      showToast(errorMessage(error), "error");
      await reloadState();
    }
  }

  function navigateTo(folderId) {
    if (folderId && !folderById(folderId)) return;
    currentFolderId = folderId || null;
    clearSelection();
    renderAll();
    dom.canvas.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function reloadState() {
    appState = normalizeState(await invoke("load_state"));
    renderAll();
  }

  async function deleteSelection() {
    const total = selectedNotes.size + selectedFolders.size;
    if (!total) return;
    const folderWarning = selectedFolders.size
      ? " Выбранные папки удалятся вместе со всем содержимым."
      : "";
    const confirmed = await openDialog({
      title: "Удалить выбранное?",
      text: `Будет удалено: ${pluralRu(total, "элемент", "элемента", "элементов")}.${folderWarning}`,
      confirmLabel: "Удалить",
      danger: true,
      icon: "trash"
    });
    if (!confirmed) return;

    const noteIds = Array.from(selectedNotes);
    const folderIds = Array.from(selectedFolders);
    try {
      if (openNoteId && noteIds.includes(openNoteId)) hideOverlay();
      await invoke("delete_items", { noteIds, folderIds });
      selectedNotes.clear();
      selectedFolders.clear();
      await reloadState();
      showToast("Удалено");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  dom.sidebarToggle.addEventListener("click", () => applySidebarCollapsed(true));
  dom.sidebarShowButton.addEventListener("click", () => applySidebarCollapsed(false));
  dom.rootButton.addEventListener("click", () => navigateTo(null));
  dom.brandButton.addEventListener("click", () => navigateTo(null));
  dom.folderTree.addEventListener("click", (event) => {
    const button = event.target.closest("[data-folder-id]");
    if (button) navigateTo(button.dataset.folderId);
  });
  dom.breadcrumbs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-crumb]");
    if (!button) return;
    navigateTo(button.dataset.crumb === "root" ? null : button.dataset.crumb);
  });
  dom.newNoteButton.addEventListener("click", beginCreateNote);
  dom.emptyNewNote.addEventListener("click", beginCreateNote);
  dom.newFolderButton.addEventListener("click", beginCreateFolder);
  dom.emptyNewFolder.addEventListener("click", beginCreateFolder);
  dom.deleteButton.addEventListener("click", deleteSelection);

  dom.grid.addEventListener("click", (event) => {
    if (Date.now() < suppressCardClickUntil) return;
    const coverClear = event.target.closest("[data-folder-card-background-clear]");
    if (coverClear) {
      event.preventDefault();
      event.stopPropagation();
      pendingFolderCardBackgroundId = null;
      void clearFolderCardBackground(coverClear.dataset.folderCardBackgroundClear);
      return;
    }
    const coverButton = event.target.closest("[data-folder-card-background]");
    if (coverButton) {
      event.preventDefault();
      event.stopPropagation();
      pendingFolderCardBackgroundId = coverButton.dataset.folderCardBackground;
      dom.folderBackgroundInput.click();
      return;
    }
    const card = event.target.closest(".card");
    if (!card) return;
    const selectButton = event.target.closest("[data-select]");
    if (selectButton) {
      event.stopPropagation();
      toggleSelection(card.dataset.kind, card.dataset.id, card);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelection(card.dataset.kind, card.dataset.id, card);
      return;
    }
    if (card.dataset.kind === "folder") navigateTo(card.dataset.id);
    else openNote(card.dataset.id, false);
  });

  dom.grid.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".card-resize-handle");
    if (!handle) return;
    const card = handle.closest(".card");
    beginCardResize(event, card, handle.classList.contains("left") ? "left" : "right");
  });
  window.addEventListener("pointermove", moveCardResize, { passive: false });
  window.addEventListener("pointerup", () => { void finishCardResize(false); });
  window.addEventListener("pointercancel", () => { void finishCardResize(true); });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt") altHeld = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") altHeld = false;
  });
  window.addEventListener("blur", () => { altHeld = false; });

  dom.grid.addEventListener("dragstart", (event) => {
    if (editing || dialogOpen) {
      event.preventDefault();
      return;
    }
    const folderCard = event.target.closest(".folder-card");
    if (folderCard) {
      if (event.target.closest("[data-select], [data-folder-card-background], [data-folder-card-background-clear], .card-resize-handle")) {
        event.preventDefault();
        return;
      }
      const folder = folderById(folderCard.dataset.id);
      folderDragState = {
        id: folderCard.dataset.id,
        placeAfter: false,
        selectionKey: folder ? categorySelectionKey(folder) : ""
      };
      suppressCardClickUntil = Date.now() + 500;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", folderCard.dataset.id);
      window.setTimeout(() => {
        if (folderDragState && folderDragState.id === folderCard.dataset.id) {
          folderCard.classList.add("dragging");
        }
      }, 0);
      return;
    }
    const card = event.target.closest(".note-card");
    if (!card || event.target.closest("[data-select]") || event.target.closest(".card-resize-handle")) {
      event.preventDefault();
      return;
    }
    const note = noteById(card.dataset.id);
    const copyIntent = Boolean(
      event.altKey || altHeld || (event.getModifierState && event.getModifierState("Alt"))
    );
    noteDragState = {
      id: card.dataset.id,
      placeAfter: false,
      isCopy: copyIntent,
      selectionKey: note ? categorySelectionKey(note) : ""
    };
    suppressCardClickUntil = Date.now() + 500;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", card.dataset.id);
    window.setTimeout(() => {
      card.classList.add("dragging");
      if (noteDragState && noteDragState.isCopy) {
        card.classList.add("is-copy-dragging");
        document.body.classList.add("is-copy-dragging");
      }
    }, 0);
  });

  dom.grid.addEventListener("dragover", (event) => {
    if (categoryDragState) {
      const targetCard = event.target.closest(".card");
      if (!targetCard) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      clearNoteDropMarkers();
      const category = categoryById(categoryDragState.id);
      if (category) targetCard.style.setProperty("--category-drop-color", category.color);
      targetCard.classList.add("category-drop-target");
      return;
    }
    if (folderDragState) {
      const card = event.target.closest(".folder-card");
      if (!card || card.dataset.id === folderDragState.id) return;
      const targetFolder = folderById(card.dataset.id);
      if (!targetFolder || categorySelectionKey(targetFolder) !== folderDragState.selectionKey) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = card.getBoundingClientRect();
      folderDragState.placeAfter = event.clientX > rect.left + rect.width / 2;
      clearNoteDropMarkers();
      card.classList.add(folderDragState.placeAfter ? "drop-after" : "drop-before");
      return;
    }
    if (!noteDragState) return;
    const card = event.target.closest(".note-card");
    const copyIntent = Boolean(noteDragState.isCopy || altHeld || event.altKey);
    if (!card) {
      if (!copyIntent) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      clearNoteDropMarkers();
      return;
    }
    if (card.dataset.id === noteDragState.id) return;
    const targetNote = noteById(card.dataset.id);
    if (!targetNote) return;
    if (!copyIntent && categorySelectionKey(targetNote) !== noteDragState.selectionKey) return;
    noteDragState.isCopy = Boolean(copyIntent);
    event.preventDefault();
    event.dataTransfer.dropEffect = copyIntent ? "copy" : "move";
    const rect = card.getBoundingClientRect();
    noteDragState.placeAfter = event.clientX > rect.left + rect.width / 2;
    clearNoteDropMarkers();
    card.classList.add(noteDragState.placeAfter ? "drop-after" : "drop-before");
  });

  dom.grid.addEventListener("dragleave", (event) => {
    if (!dom.grid.contains(event.relatedTarget)) clearNoteDropMarkers();
  });

  dom.grid.addEventListener("drop", (event) => {
    suppressCardClickUntil = Date.now() + 500;
    if (categoryDragState) {
      void dropCategoryOnCard(event);
      return;
    }
    if (folderDragState) {
      void dropFolderCard(event);
      return;
    }
    void dropNoteCard(event);
  });

  dom.grid.addEventListener("dragend", () => {
    suppressCardClickUntil = Date.now() + 500;
    finishNoteDrag();
    finishFolderDrag();
  });

  dom.grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(".select-mark")) return;
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) toggleSelection(card.dataset.kind, card.dataset.id, card);
    else if (card.dataset.kind === "folder") navigateTo(card.dataset.id);
    else openNote(card.dataset.id, false);
  });

  dom.newCategoryButton.addEventListener("click", () => { void beginCreateCategory(); });
  dom.categoryToggleButton.addEventListener("click", () => {
    applyCategoryBarCollapsed(!dom.categoryBar.classList.contains("is-collapsed"));
  });
  dom.categoryList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-category]");
    if (removeButton) {
      event.preventDefault();
      event.stopPropagation();
      void beginDeleteCategory(removeButton.dataset.removeCategory);
      return;
    }
    const renameButton = event.target.closest("[data-rename-category]");
    if (renameButton) {
      event.preventDefault();
      event.stopPropagation();
      void beginRenameCategory(renameButton.dataset.renameCategory);
      return;
    }
    const addButton = event.target.closest("[data-add-subcategory]");
    if (!addButton) return;
    event.preventDefault();
    event.stopPropagation();
    void beginCreateCategory(addButton.dataset.addSubcategory);
  });
  dom.categoryList.addEventListener("change", (event) => {
    const colorInput = event.target.closest(".category-color");
    if (colorInput) {
      void updateCategoryColor(colorInput.dataset.categoryColor, colorInput.value);
    }
  });
  dom.categoryList.addEventListener("dragstart", (event) => {
    const chip = event.target.closest(".category-chip, .category-subchip");
    if (!chip || event.target.closest("input, select, button")) {
      event.preventDefault();
      return;
    }
    categoryDragState = {
      id: chip.dataset.categoryId,
      parentCategoryId: chip.dataset.parentCategoryId || null,
      placeAfter: false,
      targetId: null
    };
    suppressCardClickUntil = Date.now() + 500;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(CATEGORY_MIME, chip.dataset.categoryId);
    event.dataTransfer.setData("text/plain", chip.dataset.categoryId);
    window.setTimeout(() => chip.classList.add("dragging"), 0);
  });
  dom.categoryList.addEventListener("dragover", (event) => {
    if (!categoryDragState) return;
    const chip = event.target.closest(".category-chip, .category-subchip");
    if (!chip || chip.dataset.categoryId === categoryDragState.id) return;
    if ((chip.dataset.parentCategoryId || null) !== categoryDragState.parentCategoryId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = chip.getBoundingClientRect();
    categoryDragState.placeAfter = event.clientX > rect.left + rect.width / 2;
    categoryDragState.targetId = chip.dataset.categoryId;
    clearCategoryDropMarkers();
    chip.classList.add(categoryDragState.placeAfter ? "drop-after" : "drop-before");
  });
  dom.categoryList.addEventListener("drop", (event) => {
    if (!categoryDragState) return;
    const chip = event.target.closest(".category-chip, .category-subchip");
    if (!chip || chip.dataset.categoryId === categoryDragState.id) return;
    if ((chip.dataset.parentCategoryId || null) !== categoryDragState.parentCategoryId) return;
    event.preventDefault();
    const draggedId = categoryDragState.id;
    const targetId = chip.dataset.categoryId;
    const placeAfter = categoryDragState.placeAfter;
    finishCategoryDrag();
    suppressCardClickUntil = Date.now() + 500;
    void reorderCategory(draggedId, targetId, placeAfter);
  });
  dom.categoryList.addEventListener("dragend", () => finishCategoryDrag());

  dom.dialogConfirm.addEventListener("click", confirmDialogInput);
  dom.dialogCancel.addEventListener("click", () => finishDialog(null));
  dom.dialogClose.addEventListener("click", () => finishDialog(null));
  dom.dialogInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmDialogInput();
    }
  });
  $(".dialog-backdrop", dom.dialogLayer).addEventListener("click", () => finishDialog(null));

  function renderNoteDetails(note) {
    const place = note.folderId ? (folderById(note.folderId)?.name || "Папка") : "";
    dom.notePlace.textContent = place;
    dom.notePlace.hidden = !place;
    dom.noteDate.textContent = formatFull(note.updatedAt);
  }

  function renderNoteViewHeading(note) {
    dom.noteViewTitle.textContent = note.title;
    const subtitle = String(note.subtitle || "").trim();
    dom.noteViewSubtitle.textContent = subtitle;
    dom.noteViewSubtitle.hidden = !subtitle;
  }

  function renderNoteView(note) {
    renderNoteDetails(note);
    renderNoteViewHeading(note);
    const clean = sanitizeHtml(note.contentHtml);
    dom.noteViewContent.innerHTML = clean;
    const hasImage = Boolean(dom.noteViewContent.querySelector("img"));
    const hasText = Boolean(dom.noteViewContent.textContent.trim());
    if (!hasImage && !hasText) dom.noteViewContent.innerHTML = "";
  }

  function populateEditor(note) {
    clearSelectedEditorImage();
    dom.noteTitleInput.value = note.title;
    dom.noteSubtitleInput.value = note.subtitle || "";
    dom.noteEditor.innerHTML = sanitizeHtml(note.contentHtml);
    resizeTitleInput();
  }

  function resizeTitleInput() {
    if (!dom.noteTitleInput || dom.noteEditorWrap.hidden) return;
    dom.noteTitleInput.style.height = "auto";
    dom.noteTitleInput.style.height = `${Math.min(dom.noteTitleInput.scrollHeight, 170)}px`;
  }

  function refreshSaveButton() {
    dom.saveNoteButton.disabled = !editing || !openNoteId;
    dom.saveNoteButton.classList.toggle("dirty", Boolean(editing && openNoteId && pendingSave));
    dom.saveNoteButton.title = pendingSave && editing ? "Сохранить изменения (Ctrl+S)" : "Сохранить (Ctrl+S)";
  }

  function applyEditUi(isEditing) {
    editing = isEditing;
    dom.notePanel.classList.toggle("is-editing", isEditing);
    dom.noteView.hidden = isEditing;
    dom.noteEditorWrap.hidden = !isEditing;
    if (!isEditing) clearSelectedEditorImage();
    refreshSaveButton();
    if (isEditing) {
      resizeTitleInput();
      setSaveState("", pendingSave ? "Есть изменения" : "Сохранено");
    }
  }

  function focusTitleInput(select = true) {
    let attempts = 0;
    const focusTitle = () => {
      if (!editing || !openNoteId) return true;
      dom.noteTitleInput.focus({ preventScroll: true });
      if (select) dom.noteTitleInput.select();
      else {
        const length = dom.noteTitleInput.value.length;
        dom.noteTitleInput.setSelectionRange(length, length);
      }
      return document.activeElement === dom.noteTitleInput;
    };
    const retry = () => {
      if (focusTitle()) return;
      attempts += 1;
      if (!editing || !openNoteId || attempts >= 8) return;
      window.setTimeout(retry, 70);
    };
    retry();
    window.requestAnimationFrame(retry);
  }

  function focusEditorEnd() {
    window.requestAnimationFrame(() => {
      if (!editing) return;
      dom.noteEditor.focus();
      const range = document.createRange();
      range.selectNodeContents(dom.noteEditor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      lastEditorRange = range.cloneRange();
    });
  }

  async function startEditing(focusTarget = "editor") {
    if (!openNoteId) return;
    const note = noteById(openNoteId);
    if (!note) return;
    if (!editing) populateEditor(note);
    applyEditUi(true);
    if (focusTarget === "title") focusTitleInput(true);
    else focusEditorEnd();
  }


  async function openNote(id, focusTitle = false) {
    const note = noteById(id);
    if (!note) return;
    if (openNoteId && openNoteId !== id) await closeNote();
    openNoteId = id;
    pendingSave = false;
    populateEditor(note);
    renderNoteView(note);
    applyEditUi(true);
    dom.noteScroll.scrollTop = 0;
    dom.overlay.classList.add("open");
    dom.overlay.setAttribute("aria-hidden", "false");
    await startEditing(focusTitle ? "title" : "editor");
  }

  function hideOverlay() {
    stopVoiceInput(true);
    dom.overlay.classList.remove("open");
    dom.overlay.setAttribute("aria-hidden", "true");
    dom.noteEditor.contentEditable = "true";
    dom.voiceButton.classList.remove("listening");
    dom.voiceToast.classList.remove("show");
    openNoteId = null;
    editing = false;
    pendingSave = false;
    dom.notePanel.classList.remove("is-editing");
    refreshSaveButton();
  }

  async function closeNote() {
    if (!openNoteId) return;
    if (editing) await flushSave();
    const noteId = openNoteId;
    hideOverlay();
    renderAll();
    const card = dom.grid.querySelector(`.note-card[data-id="${CSS.escape(noteId)}"]`);
    if (card) card.focus({ preventScroll: true });
  }

  function setSaveState(kind, text) {
    dom.saveState.classList.toggle("saving", kind === "saving");
    dom.saveState.classList.toggle("error", kind === "error");
    dom.saveStateText.textContent = text;
  }

  function markDirty() {
    if (!editing || !openNoteId) return;
    editorRevision += 1;
    pendingSave = true;
    setSaveState("", "Есть изменения");
    refreshSaveButton();
  }

  async function persistNote() {
    if (!editing || !openNoteId || !pendingSave) return savePromise;

    pendingSave = false;
    setSaveState("saving", "Сохраняю…");
    refreshSaveButton();
    const noteId = openNoteId;
    const revision = editorRevision;
    const payload = {
      id: noteId,
      title: dom.noteTitleInput.value.trim() || "Без названия",
      subtitle: dom.noteSubtitleInput.value.trim(),
      contentHtml: sanitizeHtml(dom.noteEditor.innerHTML),
      plainText: dom.noteEditor.innerText.replace(/\n{3,}/g, "\n\n").trim()
    };

    savePromise = savePromise.then(async () => {
      try {
        const updated = await invoke("update_note", payload);
        const index = appState.notes.findIndex((note) => note.id === noteId);
        if (index >= 0) appState.notes[index] = updated;
        if (openNoteId === noteId) {
          renderNoteDetails(updated);
          renderNoteViewHeading(updated);
          if (editing && revision === editorRevision) {
            pendingSave = false;
            setSaveState("", "Сохранено");
          } else if (editing) {
            setSaveState("", "Есть изменения");
          }
          refreshSaveButton();
        }
      } catch (error) {
        pendingSave = true;
        setSaveState("error", "Не сохранено");
        refreshSaveButton();
        showToast(errorMessage(error), "error");
      }
    });

    await savePromise;
    if (pendingSave && editing) setSaveState("", "Есть изменения");
    refreshSaveButton();
    return savePromise;
  }

  async function saveCurrentNote(showConfirmation = true) {
    if (!editing || !openNoteId) return;
    if (!pendingSave) {
      if (showConfirmation) showToast("Изменений нет");
      return;
    }
    await persistNote();
    if (showConfirmation && !pendingSave) showToast("Сохранено");
  }

  async function flushSave() {
    if (!editing || !openNoteId) {
      await savePromise;
      return;
    }
    let attempts = 0;
    while (pendingSave && attempts < 4) {
      await persistNote();
      attempts += 1;
    }
    await savePromise;
  }

  function restoreEditorSelection() {
    dom.noteEditor.focus();
    if (lastEditorRange && dom.noteEditor.contains(lastEditorRange.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(lastEditorRange);
      return lastEditorRange.cloneRange();
    }
    const range = document.createRange();
    range.selectNodeContents(dom.noteEditor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    lastEditorRange = range.cloneRange();
    return range.cloneRange();
  }

  function insertHtmlIntoEditor(html, preferredRange = null) {
    const range = preferredRange && dom.noteEditor.contains(preferredRange.startContainer)
      ? preferredRange.cloneRange()
      : restoreEditorSelection();
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(after);
      lastEditorRange = after.cloneRange();
    }
    markDirty();
  }

  function insertTextIntoEditor(text, preferredRange = null) {
    const value = String(text || "").trim();
    if (!value) return preferredRange ? preferredRange.cloneRange() : lastEditorRange;
    const range = preferredRange && dom.noteEditor.contains(preferredRange.startContainer)
      ? preferredRange.cloneRange()
      : restoreEditorSelection();
    range.deleteContents();
    const node = document.createTextNode(`${value} `);
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(after);
    lastEditorRange = after.cloneRange();
    markDirty();
    window.requestAnimationFrame(() => node.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    return after.cloneRange();
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать изображение"));
      reader.readAsDataURL(blob);
    });
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Не удалось открыть изображение"));
      };
      image.src = url;
    });
  }

  async function optimizeImage(file) {
    let source;
    try {
      source = await createImageBitmap(file);
    } catch (_) {
      source = await loadImageElement(file);
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("Пустое изображение");
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();

    let blob = await canvasToBlob(canvas, "image/webp", 0.84);
    if (blob && blob.size > 1100000) blob = await canvasToBlob(canvas, "image/webp", 0.7);
    if (!blob) throw new Error("Не удалось подготовить изображение");
    return blobToDataUrl(blob);
  }

  function editorContentWidth() {
    const styles = window.getComputedStyle(dom.noteEditor);
    const padding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    return Math.max(1, dom.noteEditor.clientWidth - padding);
  }

  function imageWidthPercent(image) {
    const width = String(image && image.style ? image.style.width : "").trim();
    if (width.endsWith("%")) {
      const parsed = parseFloat(width);
      if (Number.isFinite(parsed)) return Math.max(20, Math.min(100, Math.round(parsed)));
    }
    const container = editorContentWidth();
    const rendered = image.getBoundingClientRect().width;
    return Math.max(20, Math.min(100, Math.round((rendered / container) * 100)));
  }

  function hideImageResizeUi() {
    dom.imageResizeToolbar.hidden = true;
    dom.imageResizeHandle.hidden = true;
  }

  function clearSelectedEditorImage() {
    if (selectedEditorImage) selectedEditorImage.classList.remove("selected");
    selectedEditorImage = null;
    imageResizeDrag = null;
    document.body.classList.remove("image-resizing");
    hideImageResizeUi();
  }

  function updateImageResizeUi() {
    if (!editing || !selectedEditorImage || !dom.noteEditor.contains(selectedEditorImage)) {
      hideImageResizeUi();
      return;
    }
    const rect = selectedEditorImage.getBoundingClientRect();
    if (rect.width <= 0 || rect.bottom < 52 || rect.top > window.innerHeight - 18) {
      hideImageResizeUi();
      return;
    }
    const percent = imageWidthPercent(selectedEditorImage);
    dom.imageSizeLabel.textContent = `${percent}%`;
    dom.imageResizeToolbar.hidden = false;
    dom.imageResizeHandle.hidden = false;

    const toolbarWidth = dom.imageResizeToolbar.offsetWidth;
    const toolbarHeight = dom.imageResizeToolbar.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - toolbarWidth - 8, rect.left + rect.width / 2 - toolbarWidth / 2));
    let top = rect.top - toolbarHeight - 10;
    if (top < 8) top = Math.min(window.innerHeight - toolbarHeight - 8, rect.bottom + 10);
    dom.imageResizeToolbar.style.left = `${left}px`;
    dom.imageResizeToolbar.style.top = `${Math.max(8, top)}px`;

    dom.imageResizeHandle.style.left = `${Math.max(0, Math.min(window.innerWidth - 18, rect.right - 9))}px`;
    dom.imageResizeHandle.style.top = `${Math.max(0, Math.min(window.innerHeight - 18, rect.bottom - 9))}px`;
  }

  function selectEditorImage(image) {
    if (!image || !editing || !dom.noteEditor.contains(image)) return;
    if (selectedEditorImage && selectedEditorImage !== image) selectedEditorImage.classList.remove("selected");
    selectedEditorImage = image;
    image.classList.add("selected");
    updateImageResizeUi();
  }

  function applyImageWidth(image, percent, shouldMarkDirty = true) {
    if (!image) return;
    const value = Math.max(20, Math.min(100, Math.round(percent)));
    if (value >= 100) image.style.removeProperty("width");
    else image.style.width = `${value}%`;
    dom.imageSizeLabel.textContent = `${value}%`;
    if (shouldMarkDirty) markDirty();
    updateImageResizeUi();
  }

  function changeSelectedImageWidth(delta) {
    if (!selectedEditorImage) return;
    applyImageWidth(selectedEditorImage, imageWidthPercent(selectedEditorImage) + delta);
  }

  function resetSelectedImageWidth() {
    if (!selectedEditorImage) return;
    applyImageWidth(selectedEditorImage, 100);
  }

  function handleEditorImageClick(event) {
    if (!editing) return;
    const target = event.target instanceof Element ? event.target.closest("img") : null;
    if (target && dom.noteEditor.contains(target)) {
      selectEditorImage(target);
      return;
    }
    clearSelectedEditorImage();
  }

  function moveImageResize(event) {
    if (!imageResizeDrag) return;
    event.preventDefault();
    const width = Math.max(
      imageResizeDrag.containerWidth * 0.2,
      Math.min(imageResizeDrag.containerWidth, imageResizeDrag.startWidth + event.clientX - imageResizeDrag.startX)
    );
    applyImageWidth(imageResizeDrag.image, (width / imageResizeDrag.containerWidth) * 100, false);
  }

  function finishImageResize() {
    if (!imageResizeDrag) return;
    const image = imageResizeDrag.image;
    imageResizeDrag = null;
    document.body.classList.remove("image-resizing");
    window.removeEventListener("pointermove", moveImageResize);
    window.removeEventListener("pointerup", finishImageResize);
    window.removeEventListener("pointercancel", finishImageResize);
    if (image) markDirty();
    updateImageResizeUi();
  }

  function beginImageResize(event) {
    if (!selectedEditorImage || event.button !== 0) return;
    event.preventDefault();
    imageResizeDrag = {
      image: selectedEditorImage,
      startX: event.clientX,
      startWidth: selectedEditorImage.getBoundingClientRect().width,
      containerWidth: editorContentWidth()
    };
    document.body.classList.add("image-resizing");
    window.addEventListener("pointermove", moveImageResize);
    window.addEventListener("pointerup", finishImageResize);
    window.addEventListener("pointercancel", finishImageResize);
  }

  async function insertImageFiles(files) {
    const imageFiles = Array.from(files || []).filter((file) => file && /^image\//i.test(file.type));
    if (!imageFiles.length) return;
    const insertionRange = lastEditorRange && dom.noteEditor.contains(lastEditorRange.startContainer)
      ? lastEditorRange.cloneRange()
      : restoreEditorSelection();
    const sources = [];
    for (const file of imageFiles) {
      try {
        sources.push(await optimizeImage(file));
      } catch (error) {
        showToast(errorMessage(error), "error");
      }
    }
    if (!sources.length) return;
    const html = `${sources.map((source) => `<img src="${source}" alt="Вставленное изображение">`).join("")}<p><br></p>`;
    insertHtmlIntoEditor(html, insertionRange);
    showToast(pluralRu(sources.length, "Картинка вставлена", "Картинки вставлены", "Картинки вставлены"));
  }

  async function handleEditorPaste(event) {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((item) => item.kind === "file" && /^image\//i.test(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.rangeCount && dom.noteEditor.contains(selection.anchorNode)) {
      lastEditorRange = selection.getRangeAt(0).cloneRange();
    }
    await insertImageFiles(files);
  }

  function updateFormatState() {
    if (!editing) return;
    ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList"].forEach((command) => {
      const button = dom.formatBar.querySelector(`[data-command="${command}"]`);
      if (!button) return;
      let active = false;
      try { active = document.queryCommandState(command); } catch (_) { active = false; }
      button.classList.toggle("active", active);
    });
  }

  function showVoiceStatus(title, text, isError = false, autoHide = 0) {
    window.clearTimeout(voiceToastTimer);
    dom.voiceToast.classList.toggle("voice-error", isError);
    dom.voiceToastTitle.textContent = title;
    dom.voiceToastText.textContent = text;
    dom.voiceToast.classList.add("show");
    if (autoHide > 0) {
      voiceToastTimer = window.setTimeout(() => dom.voiceToast.classList.remove("show"), autoHide);
    }
  }

  function voiceErrorText(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Разрешите доступ к микрофону и попробуйте ещё раз.";
      case "audio-capture":
        return "Не удалось получить доступ к микрофону.";
      case "network":
        return "Сервис распознавания недоступен. Проверьте подключение к интернету.";
      case "language-not-supported":
        return "Русский язык не поддерживается сервисом распознавания.";
      case "no-speech":
        return "Речь не распознана. Попробуйте ещё раз.";
      case "aborted":
        return "Голосовой ввод прерван.";
      default:
        return "Не удалось распознать речь. Попробуйте ещё раз.";
    }
  }

  function endVoiceSession(session, message = "", isError = false) {
    if (!session) return;
    const isCurrent = voiceSession === session;
    session.active = false;
    window.clearTimeout(session.restartTimer);
    const recognition = session.recognition;
    session.recognition = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onspeechstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch (_) { /* already stopped */ }
    }
    if (!isCurrent) return;
    voiceSession = null;
    dom.voiceButton.classList.remove("listening");
    dom.voiceButton.setAttribute("aria-pressed", "false");
    dom.voiceButton.title = "Голосовой ввод";
    if (message) showVoiceStatus("Голосовой ввод", message, isError, isError ? 4500 : 1200);
    else {
      window.clearTimeout(voiceToastTimer);
      dom.voiceToast.classList.remove("show");
    }
    if (openNoteId === session.noteId && editing) dom.noteEditor.focus({ preventScroll: true });
  }

  function stopVoiceInput(silent = false) {
    const session = voiceSession;
    if (!session) {
      if (!silent) {
        window.clearTimeout(voiceToastTimer);
        dom.voiceToast.classList.remove("show");
      }
      return;
    }
    endVoiceSession(session, silent ? "" : "Голосовой ввод остановлен.");
  }

  async function startVoiceInput() {
    if (voiceSession) {
      stopVoiceInput();
      return;
    }
    if (!openNoteId) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Голосовой ввод не поддерживается на этом устройстве.", "error");
      return;
    }

    const noteId = openNoteId;
    if (!editing) {
      await startEditing("editor");
      await wait(80);
    }
    if (openNoteId !== noteId || !editing) return;

    const insertionRange = lastEditorRange && dom.noteEditor.contains(lastEditorRange.startContainer)
      ? lastEditorRange.cloneRange()
      : restoreEditorSelection();
    const session = {
      active: true,
      noteId,
      recognition: null,
      restartTimer: null,
      insertionRange,
      startedAt: 0,
      rapidRestarts: 0
    };
    voiceSession = session;
    dom.voiceButton.classList.add("listening");
    dom.voiceButton.setAttribute("aria-pressed", "true");
    dom.voiceButton.title = "Остановить голосовой ввод";
    showVoiceStatus("Слушаю…", "Говорите на русском…");

    const startRecognition = () => {
      if (voiceSession !== session || !session.active) return;
      const recognition = new Recognition();
      session.recognition = recognition;
      recognition.lang = VOICE_LANGUAGE;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (session.recognition !== recognition) return;
        session.startedAt = Date.now();
        showVoiceStatus("Слушаю…", "Говорите на русском…");
      };

      recognition.onspeechstart = () => {
        if (session.recognition !== recognition) return;
        showVoiceStatus("Слушаю…", "Распознаю речь…");
      };

      recognition.onresult = (event) => {
        if (session.recognition !== recognition || !session.active) return;
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result && result[0] ? String(result[0].transcript || "").trim() : "";
          if (!transcript) continue;
          if (result.isFinal) finalText += `${transcript} `;
          else interimText += `${transcript} `;
        }
        if (finalText.trim()) {
          session.insertionRange = insertTextIntoEditor(finalText.trim(), session.insertionRange) || lastEditorRange;
          session.rapidRestarts = 0;
        }
        showVoiceStatus(
          "Слушаю…",
          interimText.trim() || (finalText.trim() ? "Текст добавлен. Продолжайте говорить…" : "Говорите на русском…")
        );
      };

      recognition.onerror = (event) => {
        if (session.recognition !== recognition || !session.active) return;
        const code = String(event.error || "");
        if (code === "no-speech") {
          showVoiceStatus("Слушаю…", voiceErrorText(code));
          return;
        }
        if (code === "aborted") return;
        endVoiceSession(session, voiceErrorText(code), true);
      };

      recognition.onend = () => {
        if (session.recognition !== recognition) return;
        session.recognition = null;
        if (!session.active || voiceSession !== session) return;
        const elapsed = Date.now() - session.startedAt;
        if (elapsed < 400) session.rapidRestarts += 1;
        else session.rapidRestarts = 0;
        if (session.rapidRestarts >= 4) {
          endVoiceSession(session, "Сервис распознавания не отвечает. Попробуйте ещё раз.", true);
          return;
        }
        session.restartTimer = window.setTimeout(() => {
          if (voiceSession === session && session.active) startRecognition();
        }, 260);
      };

      try { recognition.start(); }
      catch (_) {
        session.rapidRestarts += 1;
        if (session.rapidRestarts >= 4) {
          endVoiceSession(session, "Не удалось запустить микрофон. Проверьте разрешение Windows.", true);
          return;
        }
        window.setTimeout(() => {
          if (voiceSession === session && session.active) startRecognition();
        }, 320);
      }
    };

    startRecognition();
  }

  async function deleteCurrentNote() {
    const note = noteById(openNoteId);
    if (!note) return;
    const confirmed = await openDialog({
      title: "Удалить заметку?",
      text: `«${note.title}» будет удалена без возможности восстановления.`,
      confirmLabel: "Удалить",
      danger: true,
      icon: "trash"
    });
    if (!confirmed) return;
    try {
      hideOverlay();
      await invoke("delete_items", { noteIds: [note.id], folderIds: [] });
      appState.notes = appState.notes.filter((item) => item.id !== note.id);
      renderAll();
      showToast("Заметка удалена");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  dom.closeNoteButton.addEventListener("click", closeNote);
  dom.overlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-note]")) void closeNote();
  });
  dom.deleteNoteButton.addEventListener("click", deleteCurrentNote);
  dom.saveNoteButton.addEventListener("click", () => { void saveCurrentNote(); });
  dom.voiceButton.addEventListener("click", () => { void startVoiceInput(); });
  dom.folderBackgroundButton.addEventListener("click", () => {
    pendingFolderCardBackgroundId = null;
    dom.folderBackgroundInput.click();
  });
  dom.clearFolderBackgroundButton.addEventListener("click", () => { void clearFolderBackground(); });
  dom.folderBackgroundInput.addEventListener("change", () => {
    const file = dom.folderBackgroundInput.files && dom.folderBackgroundInput.files[0];
    const folderCardBackgroundId = pendingFolderCardBackgroundId;
    dom.folderBackgroundInput.value = "";
    if (folderCardBackgroundId) void handleFolderCardBackgroundFile(file);
    else void handleFolderBackgroundFile(file);
  });

  dom.noteTitleInput.addEventListener("input", () => {
    resizeTitleInput();
    markDirty();
  });
  dom.noteTitleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.noteEditor.focus();
    }
  });
  dom.noteSubtitleInput.addEventListener("input", markDirty);
  dom.noteEditor.addEventListener("input", () => {
    markDirty();
    if (selectedEditorImage && !dom.noteEditor.contains(selectedEditorImage)) clearSelectedEditorImage();
    else if (selectedEditorImage) updateImageResizeUi();
  });
  dom.noteEditor.addEventListener("paste", handleEditorPaste);
  dom.noteEditor.addEventListener("click", handleEditorImageClick);
  dom.noteEditor.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && /^image\//i.test(item.type))) {
      event.preventDefault();
    }
  });
  dom.noteEditor.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => /^image\//i.test(file.type));
    if (!files.length) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.rangeCount && dom.noteEditor.contains(selection.anchorNode)) {
      lastEditorRange = selection.getRangeAt(0).cloneRange();
    }
    void insertImageFiles(files);
  });

  dom.formatBar.addEventListener("mousedown", (event) => {
    if (event.target.closest(".format-btn")) event.preventDefault();
  });
  dom.formatBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (!button) return;
    restoreEditorSelection();
    try { document.execCommand(button.dataset.command, false, null); } catch (_) { /* ignored */ }
    markDirty();
    updateFormatState();
  });
  dom.insertImageButton.addEventListener("mousedown", () => {
    if (lastEditorRange && dom.noteEditor.contains(lastEditorRange.startContainer)) return;
    lastEditorRange = restoreEditorSelection();
  });
  dom.insertImageButton.addEventListener("click", () => dom.imageFileInput.click());
  dom.imageFileInput.addEventListener("change", () => {
    const files = Array.from(dom.imageFileInput.files || []);
    dom.imageFileInput.value = "";
    void insertImageFiles(files);
  });

  [dom.imageNarrowerButton, dom.imageWiderButton, dom.imageResetButton].forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
  });
  dom.imageNarrowerButton.addEventListener("click", () => changeSelectedImageWidth(-10));
  dom.imageWiderButton.addEventListener("click", () => changeSelectedImageWidth(10));
  dom.imageResetButton.addEventListener("click", resetSelectedImageWidth);
  dom.imageResizeHandle.addEventListener("pointerdown", beginImageResize);
  dom.noteScroll.addEventListener("scroll", () => {
    if (selectedEditorImage) updateImageResizeUi();
  }, { passive: true });

  document.addEventListener("selectionchange", () => {
    if (!dom.noteEditor || !editing) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (dom.noteEditor.contains(range.commonAncestorContainer)) {
      lastEditorRange = range.cloneRange();
      updateFormatState();
    }
  });

  function isEditableTarget(target) {
    return target instanceof HTMLElement
      && (target.matches("input, textarea, [contenteditable='true']") || target.isContentEditable);
  }

  document.addEventListener("keydown", (event) => {
    if (dialogOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        finishDialog(null);
      }
      return;
    }
    if (event.key === "Escape" && openNoteId) {
      event.preventDefault();
      void closeNote();
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    const isKey = (code, key) => event.code === code || event.key.toLowerCase() === key;
    if (modifier && isKey("KeyN", "n")) {
      event.preventDefault();
      if (event.shiftKey) {
        if (!openNoteId) void beginCreateFolder();
      } else {
        void beginCreateNote();
      }
      return;
    }
    if (modifier && isKey("KeyS", "s") && editing) {
      event.preventDefault();
      void saveCurrentNote();
      return;
    }
    if (!openNoteId && (event.key === "Delete" || event.key === "Backspace") && !isEditableTarget(event.target)) {
      if (selectedNotes.size + selectedFolders.size) {
        event.preventDefault();
        void deleteSelection();
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    if (editing && pendingSave) void persistNote();
  });
  window.addEventListener("resize", () => {
    if (editing) resizeTitleInput();
    if (selectedEditorImage) updateImageResizeUi();
  });

  async function init() {
    applySidebarCollapsed(readSidebarPreference(), false);
    applyCategoryBarCollapsed(readCategoryBarPreference(), false);
    const started = performance.now();
    try {
      appState = normalizeState(await invoke("load_state"));
      renderAll();
    } catch (error) {
      appState = normalizeState({});
      renderAll();
      showToast(errorMessage(error), "error");
    }
    const elapsed = performance.now() - started;
    if (elapsed < 330) await wait(330 - elapsed);
    dom.loading.classList.add("hide");
  }

  void init();
})();


