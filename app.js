/**
 * Market POS — Fiyat Sözlüğü, gruplu Hızlı Kasa, Günün Özeti
 */

const STORAGE_KEY_FIYAT = "market_fiyat_sozlugu";
const STORAGE_KEY_DAILY = "dailySales";
const STORAGE_KEY_HISTORY = "salesHistory";

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return String(Date.now()) + Math.random().toString(16).slice(2);
}

function parseMoney(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function formatMoney(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return "—";
  return (
    num.toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " ₺"
  );
}

function formatDateDMY(date) {
  const d = date instanceof Date ? date : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "." + month + "." + year;
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach((m) => {
    if (!m.hidden) {
      m.hidden = true;
      m.setAttribute("aria-hidden", "true");
    }
  });
}

// ---------------------------------------------------------------------------
// Sepet (localStorage yok)
// ---------------------------------------------------------------------------

function createCart(listEl, totalEl) {
  /** @type {{ id: string, key: string, name: string, price: number, qty: number }[]} */
  let lines = [];

  function total() {
    let sum = 0;
    for (let i = 0; i < lines.length; i++) {
      const qty = Number(lines[i].qty) || 0;
      const price = Number(lines[i].price) || 0;
      sum += qty * price;
    }
    return sum;
  }

  function findIndexByKey(key) {
    return lines.findIndex((l) => l.key === key);
  }

  function decrementOrRemove(id) {
    const i = lines.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (lines[i].qty > 1) {
      lines[i] = { ...lines[i], qty: lines[i].qty - 1 };
    } else {
      lines.splice(i, 1);
    }
    render();
  }

  function render() {
    listEl.innerHTML = "";

    if (lines.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "Sepet boş. Soldan ürün seçin veya hızlı ekleyin.";
      listEl.appendChild(empty);
      totalEl.textContent = formatMoney(0);
      return;
    }

    lines.forEach((line, index) => {
      const li = document.createElement("li");
      li.className = "receipt__row";

      const left = document.createElement("div");
      left.className = "receipt__left";

      const idx = document.createElement("span");
      idx.className = "receipt__idx";
      idx.textContent = String(index + 1) + ".";

      const name = document.createElement("span");
      name.className = "receipt__name";
      name.textContent = line.name;

      const qty = document.createElement("span");
      qty.className = "qty";
      qty.textContent = "x" + line.qty;

      left.appendChild(idx);
      left.appendChild(name);
      left.appendChild(qty);

      const right = document.createElement("div");
      right.className = "receipt__right";

      const price = document.createElement("span");
      price.className = "receipt__price";
      price.textContent = formatMoney(line.qty * line.price);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "receipt__remove";
      const isLast = line.qty <= 1;
      remove.title = isLast ? "Sepetten çıkar" : "Bir adet azalt";
      remove.setAttribute(
        "aria-label",
        isLast
          ? line.name + " kalemini sepetten çıkar"
          : line.name + " kalemini bir adet azalt"
      );
      remove.textContent = "\u00D7";
      const lineId = line.id;
      remove.addEventListener("click", () => {
        decrementOrRemove(lineId);
      });

      right.appendChild(price);
      right.appendChild(remove);

      li.appendChild(left);
      li.appendChild(right);
      listEl.appendChild(li);
    });

    totalEl.textContent = formatMoney(total());
  }

  return {
    addFromProduct(product) {
      if (!product || !product.name) return;
      const price = Number(product.price);
      if (Number.isNaN(price) || price < 0) return;

      const key = "pid:" + (product.id || product.name);
      const i = findIndexByKey(key);
      if (i >= 0) {
        lines[i] = { ...lines[i], qty: lines[i].qty + 1 };
      } else {
        lines.push({
          id: newId(),
          key,
          name: String(product.name).trim(),
          price,
          qty: 1,
        });
      }
      render();
    },

    addQuickPrice(rawPrice) {
      const price = parseMoney(rawPrice);
      if (Number.isNaN(price) || price < 0) return false;

      const key = "ozel:" + price.toFixed(2);
      const i = findIndexByKey(key);
      if (i >= 0) {
        lines[i] = { ...lines[i], qty: lines[i].qty + 1 };
      } else {
        lines.push({
          id: newId(),
          key,
          name: "Özel",
          price,
          qty: 1,
        });
      }
      render();
      return true;
    },

    isEmpty() {
      return lines.length === 0;
    },

    getSnapshot() {
      return {
        lines: lines.map((l) => ({
          name: l.name,
          price: l.price,
          qty: l.qty,
        })),
        total: total(),
      };
    },

    clear() {
      lines = [];
      render();
    },

    render,
  };
}

// ---------------------------------------------------------------------------
// Fiyat Sözlüğü
// ---------------------------------------------------------------------------

function initPriceDictionary(cart) {
  const form = document.getElementById("fiyat-form");
  const hiddenEditId = document.getElementById("fiyat-editing-id");
  const inputUrun = document.getElementById("fiyat-urun");
  const inputFiyat = document.getElementById("fiyat-fiyat");
  const submitBtn = document.getElementById("fiyat-submit");
  const iptalBtn = document.getElementById("fiyat-iptal");
  const inputAra = document.getElementById("fiyat-ara");
  const liste = document.getElementById("fiyat-liste");

  let editingId = "";
  let dragId = "";

  function readProducts() {
    return loadJson(STORAGE_KEY_FIYAT, []);
  }

  function writeProducts(items) {
    saveJson(STORAGE_KEY_FIYAT, items);
  }

  function clearDropHints() {
    liste
      .querySelectorAll(".product-card.drop-before, .product-card.drop-after")
      .forEach((c) => c.classList.remove("drop-before", "drop-after"));
  }

  function reorderProducts(sourceId, targetId, placeAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const items = readProducts();
    const fromIdx = items.findIndex((x) => x.id === sourceId);
    if (fromIdx < 0) return false;
    const [moved] = items.splice(fromIdx, 1);
    let toIdx = items.findIndex((x) => x.id === targetId);
    if (toIdx < 0) {
      items.splice(fromIdx, 0, moved);
      return false;
    }
    if (placeAfter) toIdx += 1;
    items.splice(toIdx, 0, moved);
    writeProducts(items);
    return true;
  }

  function attachDragHandlers(li) {
    li.draggable = true;

    li.addEventListener("dragstart", (e) => {
      dragId = li.dataset.id || "";
      if (!dragId) {
        e.preventDefault();
        return;
      }
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", dragId);
        } catch (_) {}
      }
      li.classList.add("is-dragging");
    });

    li.addEventListener("dragend", () => {
      dragId = "";
      li.classList.remove("is-dragging");
      clearDropHints();
    });

    li.addEventListener("dragover", (e) => {
      if (!dragId || li.dataset.id === dragId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      const rect = li.getBoundingClientRect();
      const isAfter = e.clientX > rect.left + rect.width / 2;

      liste
        .querySelectorAll(".product-card.drop-before, .product-card.drop-after")
        .forEach((c) => {
          if (c !== li) c.classList.remove("drop-before", "drop-after");
        });

      li.classList.toggle("drop-after", isAfter);
      li.classList.toggle("drop-before", !isAfter);
    });

    li.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget || !li.contains(e.relatedTarget)) {
        li.classList.remove("drop-before", "drop-after");
      }
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const sourceId = dragId;
      const targetId = li.dataset.id || "";
      const placeAfter = li.classList.contains("drop-after");

      clearDropHints();
      li.classList.remove("is-dragging");

      if (!sourceId || sourceId === targetId) {
        dragId = "";
        return;
      }

      const changed = reorderProducts(sourceId, targetId, placeAfter);
      dragId = "";
      if (changed) render();
    });
  }

  function setEditingMode(id) {
    editingId = id || "";
    hiddenEditId.value = editingId;
    submitBtn.textContent = editingId ? "Güncelle" : "Ekle";
    iptalBtn.hidden = !editingId;

    const rows = liste.querySelectorAll(".product-card");
    rows.forEach((row) => {
      const rid = row.getAttribute("data-id");
      row.classList.toggle("is-editing", Boolean(editingId && rid === editingId));
    });
  }

  function clearEditingIfDeleted(deletedId) {
    if (editingId && editingId === deletedId) {
      editingId = "";
      hiddenEditId.value = "";
      submitBtn.textContent = "Ekle";
      iptalBtn.hidden = true;
      inputUrun.value = "";
      inputFiyat.value = "";
    }
  }

  iptalBtn.addEventListener("click", () => {
    setEditingMode("");
    inputUrun.value = "";
    inputFiyat.value = "";
    render();
  });

  function render() {
    const q = (inputAra.value || "").trim().toLowerCase();
    const all = readProducts();
    const filtered = q
      ? all.filter((p) => (p.name || "").toLowerCase().includes(q))
      : all;

    liste.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent =
        all.length === 0
          ? "Henüz ürün yok. Yukarıdan ekleyin."
          : "Aramanızla eşleşen ürün yok.";
      liste.appendChild(empty);
      setEditingMode(editingId);
      return;
    }

    filtered.forEach((p) => {
      const li = document.createElement("li");
      li.className = "product-card";
      li.dataset.id = p.id;
      if (editingId && p.id === editingId) {
        li.classList.add("is-editing");
      }

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "product-card__main";
      mainBtn.draggable = false;
      mainBtn.setAttribute(
        "aria-label",
        p.name + ", " + formatMoney(p.price) + " — sepete ekle"
      );

      const nameEl = document.createElement("span");
      nameEl.className = "product-card__name";
      nameEl.textContent = p.name;

      const priceEl = document.createElement("span");
      priceEl.className = "product-card__price";
      priceEl.textContent = formatMoney(p.price);

      mainBtn.appendChild(nameEl);
      mainBtn.appendChild(priceEl);
      mainBtn.addEventListener("click", () => {
        cart.addFromProduct({ id: p.id, name: p.name, price: p.price });
      });

      const actions = document.createElement("div");
      actions.className = "product-card__actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn--edit";
      editBtn.draggable = false;
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        inputUrun.value = p.name;
        inputFiyat.value = String(p.price);
        setEditingMode(p.id);
        inputUrun.focus();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--danger";
      delBtn.draggable = false;
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = readProducts().filter((x) => x.id !== p.id);
        writeProducts(next);
        clearEditingIfDeleted(p.id);
        render();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      li.appendChild(mainBtn);
      li.appendChild(actions);
      liste.appendChild(li);

      attachDragHandlers(li);
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (inputUrun.value || "").trim();
    const price = parseMoney(inputFiyat.value);

    if (!name || Number.isNaN(price) || price < 0) return;

    const items = readProducts();

    if (editingId) {
      const idx = items.findIndex((x) => x.id === editingId);
      if (idx < 0) {
        setEditingMode("");
      } else {
        items[idx] = { ...items[idx], name, price };
        writeProducts(items);
        setEditingMode("");
        inputUrun.value = "";
        inputFiyat.value = "";
        render();
        return;
      }
    }

    items.push({ id: newId(), name, price });
    writeProducts(items);
    inputUrun.value = "";
    inputFiyat.value = "";
    render();
  });

  inputAra.addEventListener("input", render);

  render();
}

// ---------------------------------------------------------------------------
// Hızlı Kasa paneli
// ---------------------------------------------------------------------------

function initCartPanel(cart) {
  const form = document.getElementById("kasa-hizli-form");
  const input = document.getElementById("kasa-hizli-fiyat");
  const temizle = document.getElementById("kasa-temizle");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (cart.addQuickPrice(input.value)) {
      input.value = "";
      input.focus();
    }
  });

  temizle.addEventListener("click", () => {
    cart.clear();
  });
}

// ---------------------------------------------------------------------------
// Günün Satışları — dailySales (localStorage)
// ---------------------------------------------------------------------------

function readDailySales() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DAILY);
    if (!raw) return { totalRevenue: 0, items: {} };
    const data = JSON.parse(raw);
    return {
      totalRevenue: Number(data && data.totalRevenue) || 0,
      items:
        data && data.items && typeof data.items === "object" ? data.items : {},
    };
  } catch {
    return { totalRevenue: 0, items: {} };
  }
}

function writeDailySales(data) {
  localStorage.setItem(STORAGE_KEY_DAILY, JSON.stringify(data));
}

function clearDailySales() {
  localStorage.removeItem(STORAGE_KEY_DAILY);
}

function readSalesHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeSalesHistory(arr) {
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(arr));
}

function clearSalesHistory() {
  localStorage.removeItem(STORAGE_KEY_HISTORY);
}

function appendDailyToHistory(daily) {
  if (!daily) return false;
  const totalCiro = Number(daily.totalRevenue) || 0;
  const soldItems =
    daily.items && typeof daily.items === "object" ? daily.items : {};
  const hasAny = totalCiro > 0 || Object.keys(soldItems).length > 0;
  if (!hasAny) return false;

  const history = readSalesHistory();
  const now = new Date();
  history.push({
    id: newId(),
    date: formatDateDMY(now),
    timestamp: now.getTime(),
    totalCiro,
    soldItems,
  });
  writeSalesHistory(history);
  return true;
}

function mergeSaleIntoDaily(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0) {
    return false;
  }

  const daily = readDailySales();

  snapshot.lines.forEach((line) => {
    const name = String(line.name || "").trim() || "Özel";
    const key = name.toLowerCase();
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const lineTotal = qty * price;
    if (qty <= 0) return;

    if (daily.items[key]) {
      daily.items[key].qty += qty;
      daily.items[key].totalPrice += lineTotal;
    } else {
      daily.items[key] = {
        name,
        qty,
        totalPrice: lineTotal,
      };
    }
  });

  daily.totalRevenue += Number(snapshot.total) || 0;
  writeDailySales(daily);
  return true;
}

function initDailySummary(cart) {
  const openBtn = document.getElementById("open-summary");
  const tamamlaBtn = document.getElementById("kasa-tamamla");
  const modal = document.getElementById("summary-modal");
  const closeBtn = document.getElementById("summary-close");
  const endDayBtn = document.getElementById("summary-end-day");
  const revenueEl = document.getElementById("summary-revenue");
  const listEl = document.getElementById("summary-list");

  function renderSummary() {
    const daily = readDailySales();

    revenueEl.textContent = formatMoney(daily.totalRevenue);

    listEl.innerHTML = "";
    const keys = Object.keys(daily.items);

    if (keys.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "Bugün henüz satış kaydı yok.";
      listEl.appendChild(empty);
      return;
    }

    keys.sort((a, b) => daily.items[b].qty - daily.items[a].qty);

    keys.forEach((k) => {
      const it = daily.items[k];
      const li = document.createElement("li");
      li.className = "modal__row";

      const nameEl = document.createElement("span");
      nameEl.className = "modal__row-name";
      nameEl.textContent = it.name;

      const qtyEl = document.createElement("span");
      qtyEl.className = "modal__row-qty";
      qtyEl.textContent = it.qty + " adet";

      const totalEl = document.createElement("span");
      totalEl.className = "modal__row-total";
      totalEl.textContent = formatMoney(it.totalPrice);

      li.appendChild(nameEl);
      li.appendChild(qtyEl);
      li.appendChild(totalEl);
      listEl.appendChild(li);
    });
  }

  function isOpen() {
    return !modal.hidden;
  }

  function openModal() {
    closeAllModals();
    renderSummary();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeyDown);
    closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && isOpen()) closeModal();
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  endDayBtn.addEventListener("click", () => {
    const daily = readDailySales();
    const hasData =
      (Number(daily.totalRevenue) || 0) > 0 ||
      Object.keys(daily.items || {}).length > 0;

    const msg = hasData
      ? "Günü kapatıp geçmişe kaydetmek istediğinize emin misiniz?"
      : "Emin misiniz? Günün satış verisi temizlenecek.";

    if (!window.confirm(msg)) return;

    if (hasData) appendDailyToHistory(daily);
    clearDailySales();
    renderSummary();
  });

  tamamlaBtn.addEventListener("click", () => {
    if (cart.isEmpty()) return;
    const snapshot = cart.getSnapshot();
    if (mergeSaleIntoDaily(snapshot)) {
      cart.clear();
      if (isOpen()) renderSummary();
    }
  });
}

// ---------------------------------------------------------------------------
// Geçmiş Günler — salesHistory (localStorage)
// ---------------------------------------------------------------------------

function initPastDays() {
  const TRASH_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true">' +
    '<path d="M3 6h18"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<line x1="10" y1="11" x2="10" y2="17"/>' +
    '<line x1="14" y1="11" x2="14" y2="17"/>' +
    "</svg>";

  const openBtn = document.getElementById("open-past-days");
  const modal = document.getElementById("past-days-modal");
  const closeBtn = document.getElementById("past-days-close");
  const clearBtn = document.getElementById("past-days-clear");
  const listEl = document.getElementById("past-days-list");

  function closeOthers(exceptDay) {
    listEl.querySelectorAll(".past-day.is-open").forEach((d) => {
      if (d === exceptDay) return;
      d.classList.remove("is-open");
      const toggle = d.querySelector(".past-day__toggle");
      const details = d.querySelector(".past-day__details");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      if (details) details.hidden = true;
    });
  }

  function syncDim() {
    const openDay = listEl.querySelector(".past-day.is-open");
    const anyOpen = Boolean(openDay);
    listEl.querySelectorAll(".past-day").forEach((d) => {
      d.classList.toggle("dim", anyOpen && d !== openDay);
    });
  }

  function deleteDay(dayId) {
    if (!dayId) return;
    if (!window.confirm("Bu günü silmek istediğinize emin misiniz?")) return;
    const next = readSalesHistory().filter((d) => d.id !== dayId);
    writeSalesHistory(next);
    render();
  }

  function buildItems(soldItems) {
    const ul = document.createElement("ul");
    ul.className = "past-day__items";

    const sold =
      soldItems && typeof soldItems === "object" ? soldItems : {};
    const keys = Object.keys(sold);

    if (keys.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "Bu güne ait ürün kaydı yok.";
      ul.appendChild(empty);
      return ul;
    }

    keys
      .sort((a, b) => (Number(sold[b].qty) || 0) - (Number(sold[a].qty) || 0))
      .forEach((k) => {
        const it = sold[k] || {};
        const row = document.createElement("li");
        row.className = "past-day__item";

        const name = document.createElement("span");
        name.className = "past-day__item-name";
        name.textContent = it.name || k;

        const qty = document.createElement("span");
        qty.className = "past-day__item-qty";
        qty.textContent = (Number(it.qty) || 0) + " adet";

        const total = document.createElement("span");
        total.className = "past-day__item-total";
        total.textContent = formatMoney(Number(it.totalPrice) || 0);

        row.appendChild(name);
        row.appendChild(qty);
        row.appendChild(total);
        ul.appendChild(row);
      });

    return ul;
  }

  function render() {
    const items = readSalesHistory();
    listEl.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent =
        "Geçmiş gün kaydı yok. Bir günü kapatınca burada görünecek.";
      listEl.appendChild(empty);
      return;
    }

    const sorted = items
      .slice()
      .sort(
        (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
      );

    sorted.forEach((day) => {
      const li = document.createElement("li");
      li.className = "past-day";
      li.dataset.id = day.id || "";

      const head = document.createElement("div");
      head.className = "past-day__head";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "past-day__toggle";
      toggle.setAttribute("aria-expanded", "false");

      const dateEl = document.createElement("span");
      dateEl.className = "past-day__date";
      dateEl.textContent = day.date || "—";

      const totalEl = document.createElement("span");
      totalEl.className = "past-day__total";
      totalEl.textContent = formatMoney(Number(day.totalCiro) || 0);

      const chev = document.createElement("span");
      chev.className = "past-day__chev";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "\u203A";

      toggle.appendChild(dateEl);
      toggle.appendChild(totalEl);
      toggle.appendChild(chev);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "past-day__delete";
      del.setAttribute("aria-label", "Bu günü sil — " + (day.date || ""));
      del.title = "Bu günü sil";
      del.innerHTML = TRASH_ICON;

      head.appendChild(toggle);
      head.appendChild(del);

      const details = document.createElement("div");
      details.className = "past-day__details";
      details.hidden = true;
      details.appendChild(buildItems(day.soldItems));

      toggle.addEventListener("click", () => {
        const wasOpen = li.classList.contains("is-open");
        closeOthers(li);
        const nowOpen = !wasOpen;
        li.classList.toggle("is-open", nowOpen);
        toggle.setAttribute("aria-expanded", nowOpen ? "true" : "false");
        details.hidden = !nowOpen;
        syncDim();
      });

      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteDay(day.id);
      });

      li.appendChild(head);
      li.appendChild(details);
      listEl.appendChild(li);
    });
  }

  function isOpen() {
    return !modal.hidden;
  }

  function openModal() {
    closeAllModals();
    render();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKey);
    closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape" && isOpen()) closeModal();
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  clearBtn.addEventListener("click", () => {
    if (
      !window.confirm(
        "Tüm geçmiş satışları silmek istediğinize emin misiniz?"
      )
    ) {
      return;
    }
    clearSalesHistory();
    render();
  });
}

// ---------------------------------------------------------------------------
// Demo Veri Yükleme
// ---------------------------------------------------------------------------

function seedDemoData() {
  const DEMO_FLAG = "market_demo_seeded_v1";
  if (localStorage.getItem(DEMO_FLAG)) return;

  // --- Fiyat Sözlüğü ---
  const demoProducts = [
    { name: "Ekmek", price: 7.5 },
    { name: "Su 0.5L", price: 5.0 },
    { name: "Su 1.5L", price: 10.0 },
    { name: "Süt 1L", price: 28.5 },
    { name: "Yoğurt 500g", price: 35.0 },
    { name: "Beyaz Peynir 200g", price: 58.0 },
    { name: "Kaşar Peyniri 200g", price: 72.0 },
    { name: "Tereyağı 250g", price: 95.0 },
    { name: "Yumurta (10'lu)", price: 65.0 },
    { name: "Domates (kg)", price: 18.0 },
    { name: "Salatalık (kg)", price: 15.0 },
    { name: "Biber (kg)", price: 22.0 },
    { name: "Soğan (kg)", price: 12.0 },
    { name: "Patates (kg)", price: 14.0 },
    { name: "Muz (kg)", price: 38.0 },
    { name: "Elma (kg)", price: 24.0 },
    { name: "Portakal (kg)", price: 20.0 },
    { name: "Tavuk Eti (kg)", price: 145.0 },
    { name: "Kıyma (kg)", price: 310.0 },
    { name: "Makarna 500g", price: 22.0 },
    { name: "Pirinç 1kg", price: 48.0 },
    { name: "Şeker 1kg", price: 38.0 },
    { name: "Un 1kg", price: 26.0 },
    { name: "Ayçiçek Yağı 1L", price: 68.0 },
    { name: "Zeytinyağı 1L", price: 195.0 },
    { name: "Çay 500g", price: 148.0 },
    { name: "Nescafé (3ü1 arada)", price: 9.0 },
    { name: "Kola 0.33L", price: 18.0 },
    { name: "Kola 1L", price: 36.0 },
    { name: "Meyve Suyu 1L", price: 42.0 },
    { name: "Ayran 200ml", price: 12.0 },
    { name: "Sigara", price: 97.0 },
    { name: "Çikolata", price: 28.0 },
    { name: "Cips (küçük)", price: 24.0 },
    { name: "Gofret", price: 16.0 },
    { name: "Bisküvi", price: 19.0 },
    { name: "Deterjan 1kg", price: 78.0 },
    { name: "Bulaşık Deterjanı 750ml", price: 55.0 },
    { name: "Tuvalet Kağıdı (6'lı)", price: 72.0 },
    { name: "Şampuan 400ml", price: 58.0 },
  ];

  const existingProducts = loadJson(STORAGE_KEY_FIYAT, []);
  if (existingProducts.length === 0) {
    const products = demoProducts.map((p) => ({ id: newId(), ...p }));
    saveJson(STORAGE_KEY_FIYAT, products);
  }

  // --- Günün Özeti (bugüne ait örnek satışlar) ---
  const rawDaily = localStorage.getItem(STORAGE_KEY_DAILY);
  if (!rawDaily) {
    const todayDaily = {
      totalRevenue: 1247.5,
      items: {
        ekmek: { name: "Ekmek", qty: 14, totalPrice: 105.0 },
        sigara: { name: "Sigara", qty: 8, totalPrice: 776.0 },
        "su 0.5l": { name: "Su 0.5L", qty: 11, totalPrice: 55.0 },
        "kola 0.33l": { name: "Kola 0.33L", qty: 6, totalPrice: 108.0 },
        "süt 1l": { name: "Süt 1L", qty: 4, totalPrice: 114.0 },
        ayran: { name: "Ayran 200ml", qty: 9, totalPrice: 108.0 },
        çikolata: { name: "Çikolata", qty: 2, totalPrice: 56.0 },
        "nescafé (3ü1 arada)": {
          name: "Nescafé (3ü1 arada)",
          qty: 4,
          totalPrice: 36.0,
        },
      },
    };
    writeDailySales(todayDaily);
  }

  // --- Geçmiş Günler ---
  const existingHistory = readSalesHistory();
  if (existingHistory.length === 0) {
    function makeTimestamp(daysAgo, hour, min) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, min, 0, 0);
      return d.getTime();
    }
    function makeDateStr(daysAgo) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return formatDateDMY(d);
    }

    const history = [
      {
        id: newId(),
        date: makeDateStr(1),
        timestamp: makeTimestamp(1, 20, 15),
        totalCiro: 3842.0,
        soldItems: {
          ekmek: { name: "Ekmek", qty: 38, totalPrice: 285.0 },
          sigara: { name: "Sigara", qty: 18, totalPrice: 1746.0 },
          "su 0.5l": { name: "Su 0.5L", qty: 24, totalPrice: 120.0 },
          "süt 1l": { name: "Süt 1L", qty: 12, totalPrice: 342.0 },
          yoğurt: { name: "Yoğurt 500g", qty: 8, totalPrice: 280.0 },
          "kola 0.33l": { name: "Kola 0.33L", qty: 10, totalPrice: 180.0 },
          "kola 1l": { name: "Kola 1L", qty: 5, totalPrice: 180.0 },
          ayran: { name: "Ayran 200ml", qty: 15, totalPrice: 180.0 },
          "yumurta (10'lu)": {
            name: "Yumurta (10'lu)",
            qty: 6,
            totalPrice: 390.0,
          },
          çikolata: { name: "Çikolata", qty: 4, totalPrice: 112.0 },
          cips: { name: "Cips (küçük)", qty: 5, totalPrice: 120.0 },
          bisküvi: { name: "Bisküvi", qty: 3, totalPrice: 57.0 },
          "meyve suyu 1l": {
            name: "Meyve Suyu 1L",
            qty: 2,
            totalPrice: 84.0,
          },
          "deterjan 1kg": { name: "Deterjan 1kg", qty: 2, totalPrice: 156.0 },
          makarna: { name: "Makarna 500g", qty: 4, totalPrice: 88.0 },
          şeker: { name: "Şeker 1kg", qty: 2, totalPrice: 76.0 },
          "nescafé (3ü1 arada)": {
            name: "Nescafé (3ü1 arada)",
            qty: 8,
            totalPrice: 72.0,
          },
          çay: { name: "Çay 500g", qty: 1, totalPrice: 148.0 },
          "su 1.5l": { name: "Su 1.5L", qty: 4, totalPrice: 40.0 },
          gofret: { name: "Gofret", qty: 4, totalPrice: 64.0 },
        },
      },
      {
        id: newId(),
        date: makeDateStr(2),
        timestamp: makeTimestamp(2, 19, 45),
        totalCiro: 2910.5,
        soldItems: {
          ekmek: { name: "Ekmek", qty: 29, totalPrice: 217.5 },
          sigara: { name: "Sigara", qty: 14, totalPrice: 1358.0 },
          "su 0.5l": { name: "Su 0.5L", qty: 18, totalPrice: 90.0 },
          ayran: { name: "Ayran 200ml", qty: 20, totalPrice: 240.0 },
          "süt 1l": { name: "Süt 1L", qty: 9, totalPrice: 256.5 },
          "kola 0.33l": { name: "Kola 0.33L", qty: 8, totalPrice: 144.0 },
          yoğurt: { name: "Yoğurt 500g", qty: 5, totalPrice: 175.0 },
          bisküvi: { name: "Bisküvi", qty: 6, totalPrice: 114.0 },
          çikolata: { name: "Çikolata", qty: 3, totalPrice: 84.0 },
          makarna: { name: "Makarna 500g", qty: 3, totalPrice: 66.0 },
          gofret: { name: "Gofret", qty: 5, totalPrice: 80.0 },
          "nescafé (3ü1 arada)": {
            name: "Nescafé (3ü1 arada)",
            qty: 5,
            totalPrice: 45.0,
          },
          "su 1.5l": { name: "Su 1.5L", qty: 3, totalPrice: 30.0 },
          cips: { name: "Cips (küçük)", qty: 4, totalPrice: 96.0 },
          şampuan: { name: "Şampuan 400ml", qty: 1, totalPrice: 58.0 },
          "tuvalet kağıdı (6'lı)": {
            name: "Tuvalet Kağıdı (6'lı)",
            qty: 2,
            totalPrice: 144.0 - 1,
          },
        },
      },
      {
        id: newId(),
        date: makeDateStr(3),
        timestamp: makeTimestamp(3, 20, 30),
        totalCiro: 4125.0,
        soldItems: {
          ekmek: { name: "Ekmek", qty: 42, totalPrice: 315.0 },
          sigara: { name: "Sigara", qty: 22, totalPrice: 2134.0 },
          "su 0.5l": { name: "Su 0.5L", qty: 30, totalPrice: 150.0 },
          ayran: { name: "Ayran 200ml", qty: 18, totalPrice: 216.0 },
          "süt 1l": { name: "Süt 1L", qty: 11, totalPrice: 313.5 },
          "kola 1l": { name: "Kola 1L", qty: 7, totalPrice: 252.0 },
          "kola 0.33l": { name: "Kola 0.33L", qty: 7, totalPrice: 126.0 },
          yoğurt: { name: "Yoğurt 500g", qty: 6, totalPrice: 210.0 },
          "yumurta (10'lu)": {
            name: "Yumurta (10'lu)",
            qty: 5,
            totalPrice: 325.0,
          },
          çikolata: { name: "Çikolata", qty: 6, totalPrice: 168.0 },
          cips: { name: "Cips (küçük)", qty: 4, totalPrice: 96.0 },
          makarna: { name: "Makarna 500g", qty: 5, totalPrice: 110.0 },
          "meyve suyu 1l": {
            name: "Meyve Suyu 1L",
            qty: 3,
            totalPrice: 126.0,
          },
          çay: { name: "Çay 500g", qty: 1, totalPrice: 148.0 },
        },
      },
      {
        id: newId(),
        date: makeDateStr(5),
        timestamp: makeTimestamp(5, 19, 0),
        totalCiro: 2250.0,
        soldItems: {
          ekmek: { name: "Ekmek", qty: 25, totalPrice: 187.5 },
          sigara: { name: "Sigara", qty: 10, totalPrice: 970.0 },
          "su 0.5l": { name: "Su 0.5L", qty: 15, totalPrice: 75.0 },
          ayran: { name: "Ayran 200ml", qty: 12, totalPrice: 144.0 },
          "süt 1l": { name: "Süt 1L", qty: 7, totalPrice: 199.5 },
          bisküvi: { name: "Bisküvi", qty: 8, totalPrice: 152.0 },
          gofret: { name: "Gofret", qty: 6, totalPrice: 96.0 },
          çikolata: { name: "Çikolata", qty: 5, totalPrice: 140.0 },
          "kola 0.33l": { name: "Kola 0.33L", qty: 6, totalPrice: 108.0 },
          "nescafé (3ü1 arada)": {
            name: "Nescafé (3ü1 arada)",
            qty: 6,
            totalPrice: 54.0,
          },
          makarna: { name: "Makarna 500g", qty: 3, totalPrice: 66.0 },
          pirinç: { name: "Pirinç 1kg", qty: 2, totalPrice: 96.0 },
          şeker: { name: "Şeker 1kg", qty: 1, totalPrice: 38.0 },
          "su 1.5l": { name: "Su 1.5L", qty: 5, totalPrice: 50.0 },
          cips: { name: "Cips (küçük)", qty: 4, totalPrice: 96.0 },
          yoğurt: { name: "Yoğurt 500g", qty: 4, totalPrice: 140.0 },
          "meyve suyu 1l": {
            name: "Meyve Suyu 1L",
            qty: 2,
            totalPrice: 84.0,
          },
        },
      },
      {
        id: newId(),
        date: makeDateStr(7),
        timestamp: makeTimestamp(7, 21, 0),
        totalCiro: 5380.0,
        soldItems: {
          ekmek: { name: "Ekmek", qty: 55, totalPrice: 412.5 },
          sigara: { name: "Sigara", qty: 28, totalPrice: 2716.0 },
          "su 0.5l": { name: "Su 0.5L", qty: 40, totalPrice: 200.0 },
          ayran: { name: "Ayran 200ml", qty: 28, totalPrice: 336.0 },
          "süt 1l": { name: "Süt 1L", qty: 15, totalPrice: 427.5 },
          "kola 1l": { name: "Kola 1L", qty: 9, totalPrice: 324.0 },
          "kola 0.33l": { name: "Kola 0.33L", qty: 12, totalPrice: 216.0 },
          yoğurt: { name: "Yoğurt 500g", qty: 9, totalPrice: 315.0 },
          çikolata: { name: "Çikolata", qty: 7, totalPrice: 196.0 },
          "yumurta (10'lu)": {
            name: "Yumurta (10'lu)",
            qty: 8,
            totalPrice: 520.0,
          },
          bisküvi: { name: "Bisküvi", qty: 6, totalPrice: 114.0 },
          cips: { name: "Cips (küçük)", qty: 7, totalPrice: 168.0 },
          makarna: { name: "Makarna 500g", qty: 6, totalPrice: 132.0 },
          çay: { name: "Çay 500g", qty: 2, totalPrice: 296.0 },
          pirinç: { name: "Pirinç 1kg", qty: 3, totalPrice: 144.0 },
          "meyve suyu 1l": {
            name: "Meyve Suyu 1L",
            qty: 3,
            totalPrice: 126.0,
          },
          "deterjan 1kg": { name: "Deterjan 1kg", qty: 2, totalPrice: 156.0 },
          şampuan: { name: "Şampuan 400ml", qty: 2, totalPrice: 116.0 },
          gofret: { name: "Gofret", qty: 8, totalPrice: 128.0 },
        },
      },
    ];
    writeSalesHistory(history);
  }

  localStorage.setItem(DEMO_FLAG, "1");
}

// ---------------------------------------------------------------------------
// Başlat
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  seedDemoData();

  const listEl = document.getElementById("kasa-liste");
  const totalEl = document.getElementById("kasa-toplam");
  const cart = createCart(listEl, totalEl);
  cart.render();

  initPriceDictionary(cart);
  initCartPanel(cart);
  initDailySummary(cart);
  initPastDays();
});
