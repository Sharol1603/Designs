(function () {
  const {
    createBackupBlob,
    createId,
    loadAssignments,
    parseBackupText,
    saveAssignments,
  } = window.SATStorage;

  const {
    filterAssignments,
    formatDueDate,
    getCounts,
    getDisplayStatus,
    getOverdue,
    getUpcoming,
    isDueToday,
    sortAssignments,
    statusLabel,
    uniqueSubjects,
  } = window.SATStatus;

  let assignments = [];

  let listFilters = {
    status: "all",
    subject: "",
  };

  let toastTimer = 0;
  let saveLock = false;
  let pendingBackupFile = null;

  const mainEl = document.getElementById("main");
  const toastEl = document.getElementById("toast");
  const dialogRoot = document.getElementById("dialog-root");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.hidden = false;
  toastEl.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastEl.textContent = "";
  }, 2800);
}

/**
 * @param {{ title: string, message: string, confirmLabel: string, cancelLabel: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
function confirmDialog(options) {
  return new Promise((resolve) => {
    if (!dialogRoot) {
      resolve(window.confirm(options.message));
      return;
    }

    dialogRoot.hidden = false;
    dialogRoot.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">${escapeHtml(options.title)}</h2>
        <p>${escapeHtml(options.message)}</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--secondary" data-action="cancel">${escapeHtml(options.cancelLabel)}</button>
          <button type="button" class="btn ${options.danger ? "btn--danger" : "btn--primary"}" data-action="confirm">${escapeHtml(options.confirmLabel)}</button>
        </div>
      </div>
    `;

    const previouslyFocused = document.activeElement;
    const cancelBtn = dialogRoot.querySelector('[data-action="cancel"]');
    const confirmBtn = dialogRoot.querySelector('[data-action="confirm"]');
    cancelBtn?.focus();

    const close = (result) => {
      dialogRoot.hidden = true;
      dialogRoot.innerHTML = "";
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    cancelBtn?.addEventListener("click", () => close(false));
    confirmBtn?.addEventListener("click", () => close(true));
    dialogRoot.addEventListener(
      "click",
      (event) => {
        if (event.target === dialogRoot) close(false);
      },
      { once: true }
    );
  });
}

function persist() {
  const result = saveAssignments(assignments);
  if (!result.ok) {
    showToast(result.error);
    return false;
  }
  return true;
}

function bootstrap() {
  const loaded = loadAssignments();
  assignments = loaded.data;
  if (!loaded.ok) {
    showToast(loaded.error);
  }
  window.addEventListener("hashchange", render);
  if (!window.location.hash) {
    window.location.hash = "#/";
  } else {
    render();
  }
}

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) return { name: "dashboard" };
  if (parts[0] === "assignments") return { name: "assignments" };
  if (parts[0] === "add") return { name: "add" };
  if (parts[0] === "data") return { name: "data" };
  if (parts[0] === "edit" && parts[1]) return { name: "edit", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "assignment" && parts[1]) {
    return { name: "details", id: decodeURIComponent(parts[1]) };
  }
  return { name: "notfound" };
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const key = link.getAttribute("data-nav");
    const active =
      (name === "dashboard" && key === "dashboard") ||
      ((name === "assignments" || name === "details" || name === "add" || name === "edit") &&
        key === "assignments") ||
      (name === "data" && key === "data");
    link.classList.toggle("is-active", Boolean(active));
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderStatusBadge(assignment) {
  const display = getDisplayStatus(assignment.dueDate, assignment.status);
  const dueToday = isDueToday(assignment.dueDate, assignment.status);
  const label = dueToday ? "Due today" : statusLabel(display);
  const className = dueToday
    ? "status-badge status-badge--due-today"
    : `status-badge status-badge--${display}`;
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

/**
 * @param {Assignment} assignment
 * @param {{ showQuickComplete?: boolean }} [options]
 */
function renderAssignmentRow(assignment, options = {}) {
  const display = getDisplayStatus(assignment.dueDate, assignment.status);
  const itemClass = [
    "assignment-item",
    display === "overdue" ? "assignment-item--overdue" : "",
    display === "completed" ? "assignment-item--completed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const quickAction =
    options.showQuickComplete && assignment.status === "pending"
      ? `<button type="button" class="btn btn--small btn--secondary" data-complete="${escapeHtml(assignment.id)}">Mark complete</button>`
      : options.showQuickComplete && assignment.status === "completed"
        ? `<button type="button" class="btn btn--small btn--secondary" data-reopen="${escapeHtml(assignment.id)}">Move to pending</button>`
        : "";

  return `
    <li class="${itemClass}">
      <div class="assignment-item__main">
        <h3 class="assignment-item__title">
          <a href="#/assignment/${encodeURIComponent(assignment.id)}">${escapeHtml(assignment.title)}</a>
        </h3>
        <div class="assignment-meta">
          <span>${escapeHtml(assignment.subject)}</span>
          <span>Due ${escapeHtml(formatDueDate(assignment.dueDate))}</span>
          ${renderStatusBadge(assignment)}
        </div>
      </div>
      <div class="assignment-item__actions">
        <a class="btn btn--small btn--ghost" href="#/assignment/${encodeURIComponent(assignment.id)}">Open details</a>
        ${quickAction}
      </div>
    </li>
  `;
}

function renderEmptyPlanner() {
  return `
    <div class="empty-state panel--lavender">
      <h2>Your planner is ready</h2>
      <p>Add your first assignment with a title, subject and due date. Everything stays in this browser on this device.</p>
      <a class="btn btn--primary" href="#/add">Add your first assignment</a>
    </div>
  `;
}

function renderDashboard() {
  const counts = getCounts(assignments);
  const upcoming = getUpcoming(assignments);
  const overdue = getOverdue(assignments);

  if (assignments.length === 0) {
    return `
      <section aria-labelledby="dash-title">
        <h1 id="dash-title" class="page-title">My assignments</h1>
        <p class="page-lead">Keep track of what’s due next.</p>
        ${renderSummary(counts)}
        ${renderEmptyPlanner()}
      </section>
    `;
  }

  const upcomingBlock =
    upcoming.length === 0
      ? `
        <div class="empty-state">
          <h3>No upcoming assignments</h3>
          <p>No pending tasks have a due date of today or later. You can still review all assignments from the Assignments page.</p>
          <a class="btn btn--secondary" href="#/assignments">View all assignments</a>
        </div>
      `
      : `<ul class="assignment-list">${upcoming
          .slice(0, 8)
          .map((item) => renderAssignmentRow(item, { showQuickComplete: true }))
          .join("")}</ul>`;

  const overdueBlock =
    overdue.length === 0
      ? `
        <div class="empty-state panel--mint">
          <h3>You’re all caught up on overdue work.</h3>
          <p>Nothing pending is past its due date right now.</p>
        </div>
      `
      : `<ul class="assignment-list">${overdue
          .map((item) => renderAssignmentRow(item, { showQuickComplete: true }))
          .join("")}</ul>`;

  return `
    <section aria-labelledby="dash-title">
      <h1 id="dash-title" class="page-title">My assignments</h1>
      <p class="page-lead">Keep track of what’s due next.</p>
      ${renderSummary(counts)}
      <div class="two-col">
        <section class="section-block" aria-labelledby="upcoming-title">
          <h2 id="upcoming-title" class="section-title">Upcoming</h2>
          ${upcomingBlock}
        </section>
        <section class="section-block" aria-labelledby="overdue-title">
          <h2 id="overdue-title" class="section-title">Overdue</h2>
          ${overdueBlock}
        </section>
      </div>
      <p class="inline-note" style="margin-top: 1.5rem;">
        Looking for completed work or every subject at once?
        <a href="#/assignments">Open the Assignments list</a>.
      </p>
    </section>
  `;
}

function renderSummary(counts) {
  return `
    <div class="summary-grid" aria-label="Assignment summary">
      <article class="summary-card summary-card--total">
        <span class="summary-card__label">Total</span>
        <span class="summary-card__value">${counts.total}</span>
      </article>
      <article class="summary-card summary-card--pending">
        <span class="summary-card__label">Pending</span>
        <span class="summary-card__value">${counts.pending}</span>
      </article>
      <article class="summary-card summary-card--overdue">
        <span class="summary-card__label">Overdue</span>
        <span class="summary-card__value">${counts.overdue}</span>
      </article>
      <article class="summary-card summary-card--completed">
        <span class="summary-card__label">Completed</span>
        <span class="summary-card__value">${counts.completed}</span>
      </article>
    </div>
  `;
}

function renderAssignmentsList() {
  const subjects = uniqueSubjects(assignments);
  const filtered = sortAssignments(
    filterAssignments(assignments, listFilters.status, listFilters.subject)
  );
  const counts = getCounts(assignments);

  const subjectOptions = [
    `<option value="">All subjects</option>`,
    ...subjects.map(
      (subject) =>
        `<option value="${escapeHtml(subject)}" ${
          listFilters.subject === subject ? "selected" : ""
        }>${escapeHtml(subject)}</option>`
    ),
  ].join("");

  const tabs = [
    ["all", "All"],
    ["pending", "Pending"],
    ["overdue", "Overdue"],
    ["completed", "Completed"],
  ]
    .map(
      ([value, label]) => `
      <button
        type="button"
        class="filter-tab"
        role="tab"
        aria-selected="${listFilters.status === value ? "true" : "false"}"
        data-status-filter="${value}"
      >${label}</button>`
    )
    .join("");

  const activeBits = [];
  if (listFilters.status !== "all") {
    activeBits.push(
      `<span class="chip">Status: ${escapeHtml(
        listFilters.status.charAt(0).toUpperCase() + listFilters.status.slice(1)
      )}</span>`
    );
  }
  if (listFilters.subject) {
    activeBits.push(`<span class="chip">Subject: ${escapeHtml(listFilters.subject)}</span>`);
  }

  let body = "";
  if (assignments.length === 0) {
    body = renderEmptyPlanner();
  } else if (filtered.length === 0) {
    body = `
      <div class="empty-state">
        <h2>No assignments match these filters</h2>
        <p>Try another status or subject, or clear the filters to see everything again.</p>
        <button type="button" class="btn btn--secondary" data-clear-filters>Clear filters</button>
      </div>
    `;
  } else {
    body = `<ul class="assignment-list">${filtered
      .map((item) => renderAssignmentRow(item, { showQuickComplete: true }))
      .join("")}</ul>`;
  }

  return `
    <section aria-labelledby="list-title">
      <h1 id="list-title" class="page-title">Assignments</h1>
      <p class="page-lead">Filter by status and subject. Pending includes overdue work.</p>
      ${renderSummary(counts)}
      <div class="filters">
        <div class="filter-tabs" role="tablist" aria-label="Status filter">
          ${tabs}
        </div>
        <div class="filter-field">
          <label for="subject-filter">Subject</label>
          <select id="subject-filter" data-subject-filter>
            ${subjectOptions}
          </select>
        </div>
      </div>
      ${
        activeBits.length
          ? `<div class="active-filters" aria-live="polite">
              <span class="small muted">Active filters:</span>
              ${activeBits.join("")}
              <button type="button" class="btn btn--small btn--ghost" data-clear-filters>Clear filters</button>
            </div>`
          : ""
      }
      ${body}
    </section>
  `;
}

/**
 * @param {Assignment | null} existing
 */
function renderForm(existing) {
  const isEdit = Boolean(existing);
  const subjects = uniqueSubjects(assignments);
  const datalist = subjects
    .map((subject) => `<option value="${escapeHtml(subject)}"></option>`)
    .join("");

  return `
    <section aria-labelledby="form-title">
      <a class="back-link" href="${
        isEdit ? `#/assignment/${encodeURIComponent(existing.id)}` : "#/assignments"
      }">← Back</a>
      <h1 id="form-title" class="page-title">${isEdit ? "Edit assignment" : "Add assignment"}</h1>
      <p class="page-lead">${
        isEdit
          ? "Update the details below, then save your changes."
          : "Enter a title, subject and due date. Notes are optional."
      }</p>
      <form class="form panel" id="assignment-form" novalidate data-mode="${isEdit ? "edit" : "add"}" data-id="${
        existing ? escapeHtml(existing.id) : ""
      }">
        <div class="field" data-field="title">
          <label for="title">Assignment title <span class="req" aria-hidden="true">*</span></label>
          <input id="title" name="title" type="text" maxlength="120" required autocomplete="off"
            value="${escapeHtml(existing?.title || "")}" aria-required="true" />
          <p class="field-error" id="title-error" hidden></p>
        </div>
        <div class="field" data-field="subject">
          <label for="subject">Subject <span class="req" aria-hidden="true">*</span></label>
          <input id="subject" name="subject" type="text" list="subject-suggestions" required autocomplete="off"
            value="${escapeHtml(existing?.subject || "")}" aria-required="true" />
          <datalist id="subject-suggestions">${datalist}</datalist>
          <p class="field-error" id="subject-error" hidden></p>
        </div>
        <div class="field" data-field="dueDate">
          <label for="dueDate">Due date <span class="req" aria-hidden="true">*</span></label>
          <input id="dueDate" name="dueDate" type="date" required
            value="${escapeHtml(existing?.dueDate || "")}" aria-required="true" />
          <p class="field-error" id="dueDate-error" hidden></p>
        </div>
        <div class="field" data-field="notes">
          <label for="notes">Notes <span class="muted small">(optional)</span></label>
          <textarea id="notes" name="notes" maxlength="2000">${escapeHtml(existing?.notes || "")}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn--primary" data-submit>
            ${isEdit ? "Save changes" : "Save assignment"}
          </button>
          <button type="button" class="btn btn--secondary" data-cancel>Cancel</button>
        </div>
      </form>
    </section>
  `;
}

/**
 * @param {Assignment} assignment
 */
function renderDetails(assignment) {
  const display = getDisplayStatus(assignment.dueDate, assignment.status);
  const primaryAction =
    assignment.status === "pending"
      ? `<button type="button" class="btn btn--primary" data-complete="${escapeHtml(assignment.id)}">Mark complete</button>`
      : `<button type="button" class="btn btn--primary" data-reopen="${escapeHtml(assignment.id)}">Move to pending</button>`;

  const notesBlock = assignment.notes.trim()
    ? `
      <div>
        <h2 class="section-title">Notes</h2>
        <div class="notes-block">${escapeHtml(assignment.notes)}</div>
      </div>
    `
    : "";

  return `
    <section aria-labelledby="detail-title">
      <a class="back-link" href="#/assignments">← Back to assignments</a>
      <article class="panel detail-card">
        <div>
          <h1 id="detail-title" class="page-title">${escapeHtml(assignment.title)}</h1>
          <div class="assignment-meta" style="margin-top: 0.75rem;">
            ${renderStatusBadge(assignment)}
            <span class="small muted">Status uses the same date rules as the dashboard.</span>
          </div>
        </div>
        <dl class="detail-grid">
          <div class="detail-item">
            <dt>Subject</dt>
            <dd>${escapeHtml(assignment.subject)}</dd>
          </div>
          <div class="detail-item">
            <dt>Due date</dt>
            <dd>${escapeHtml(formatDueDate(assignment.dueDate))}</dd>
          </div>
          <div class="detail-item">
            <dt>Status</dt>
            <dd>${escapeHtml(statusLabel(display))}${
              isDueToday(assignment.dueDate, assignment.status) ? " (due today)" : ""
            }</dd>
          </div>
        </dl>
        ${notesBlock}
        <div class="btn-row">
          ${primaryAction}
          <a class="btn btn--secondary" href="#/edit/${encodeURIComponent(assignment.id)}">Edit</a>
          <button type="button" class="btn btn--danger" data-delete="${escapeHtml(assignment.id)}">Delete</button>
        </div>
      </article>
    </section>
  `;
}

function renderDataPage() {
  const counts = getCounts(assignments);
  return `
    <section aria-labelledby="data-title">
      <h1 id="data-title" class="page-title">Your Data</h1>
      <p class="page-lead">
        Assignments are saved in this browser on this device. They do not sync to the cloud or to other devices.
      </p>

      <div class="notice" style="margin-bottom: 1.5rem;">
        <strong>Local storage only.</strong>
        Clearing site data, using another browser, or switching devices can hide this list.
        Download a backup if you want a copy you can restore later.
      </div>

      <div class="summary-grid" aria-label="Current saved totals">
        <article class="summary-card summary-card--total">
          <span class="summary-card__label">Saved assignments</span>
          <span class="summary-card__value">${counts.total}</span>
        </article>
        <article class="summary-card summary-card--pending">
          <span class="summary-card__label">Pending</span>
          <span class="summary-card__value">${counts.pending}</span>
        </article>
        <article class="summary-card summary-card--overdue">
          <span class="summary-card__label">Overdue</span>
          <span class="summary-card__value">${counts.overdue}</span>
        </article>
        <article class="summary-card summary-card--completed">
          <span class="summary-card__label">Completed</span>
          <span class="summary-card__value">${counts.completed}</span>
        </article>
      </div>

      <div class="data-grid">
        <article class="panel data-card panel--mint">
          <h2>Download backup</h2>
          <p>Save a JSON copy of your current assignments to this device.</p>
          <button type="button" class="btn btn--primary" data-backup-download>Download backup</button>
        </article>

        <article class="panel data-card panel--blush">
          <h2>Restore backup</h2>
          <p>Replace the assignments saved in this browser with a backup file. This cannot be undone.</p>
          <div class="file-input-row">
            <label class="btn btn--secondary" for="backup-file">Choose backup file</label>
            <input id="backup-file" class="sr-only" type="file" accept="application/json,.json" data-backup-file />
            <p class="small muted" data-backup-filename>No file chosen yet.</p>
            <button type="button" class="btn btn--danger" data-backup-restore disabled>Restore backup</button>
          </div>
          <p class="field-error" data-backup-error hidden></p>
        </article>
      </div>
    </section>
  `;
}

function renderNotFound() {
  return `
    <section>
      <h1 class="page-title">Page not found</h1>
      <p class="page-lead">That screen does not exist in this planner.</p>
      <a class="btn btn--primary" href="#/">Back to dashboard</a>
    </section>
  `;
}

function render() {
  if (!mainEl) return;
  const route = parseRoute();
  setActiveNav(route.name);

  if (route.name === "dashboard") {
    mainEl.innerHTML = renderDashboard();
  } else if (route.name === "assignments") {
    mainEl.innerHTML = renderAssignmentsList();
  } else if (route.name === "add") {
    mainEl.innerHTML = renderForm(null);
    bindForm();
  } else if (route.name === "edit") {
    const existing = assignments.find((item) => item.id === route.id);
    if (!existing) {
      mainEl.innerHTML = `
        <section>
          <h1 class="page-title">Assignment not found</h1>
          <p class="page-lead">It may have been deleted, or this link is out of date.</p>
          <a class="btn btn--primary" href="#/assignments">Back to assignments</a>
        </section>
      `;
    } else {
      mainEl.innerHTML = renderForm(existing);
      bindForm();
    }
  } else if (route.name === "details") {
    const existing = assignments.find((item) => item.id === route.id);
    if (!existing) {
      mainEl.innerHTML = `
        <section>
          <h1 class="page-title">Assignment not found</h1>
          <p class="page-lead">It may have been deleted, or this link is out of date.</p>
          <a class="btn btn--primary" href="#/assignments">Back to assignments</a>
        </section>
      `;
    } else {
      mainEl.innerHTML = renderDetails(existing);
    }
  } else if (route.name === "data") {
    mainEl.innerHTML = renderDataPage();
    bindDataPage();
  } else {
    mainEl.innerHTML = renderNotFound();
  }

  bindGlobalActions();
  mainEl.focus({ preventScroll: true });
}

function bindGlobalActions() {
  mainEl?.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-complete");
      if (id) completeAssignment(id);
    });
  });

  mainEl?.querySelectorAll("[data-reopen]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-reopen");
      if (id) reopenAssignment(id);
    });
  });

  mainEl?.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-delete");
      if (id) deleteAssignment(id);
    });
  });

  mainEl?.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-status-filter");
      if (value === "all" || value === "pending" || value === "overdue" || value === "completed") {
        listFilters.status = value;
        render();
      }
    });
  });

  const subjectFilter = mainEl?.querySelector("[data-subject-filter]");
  subjectFilter?.addEventListener("change", (event) => {
    const target = /** @type {HTMLSelectElement} */ (event.target);
    listFilters.subject = target.value;
    render();
  });

  mainEl?.querySelectorAll("[data-clear-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      listFilters = { status: "all", subject: "" };
      render();
    });
  });
}

function bindForm() {
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("assignment-form"));
  if (!form) return;

  const initial = new FormData(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saveLock) return;

    clearFieldErrors(form);
    const title = String(form.title.value || "").trim();
    const subject = String(form.subject.value || "").trim();
    const dueDate = String(form.dueDate.value || "").trim();
    const notes = String(form.notes.value || "");

    let valid = true;
    if (!title) {
      setFieldError(form, "title", "Enter an assignment title.");
      valid = false;
    } else if (title.length > 120) {
      setFieldError(form, "title", "Keep the title to 120 characters or fewer.");
      valid = false;
    }
    if (!subject) {
      setFieldError(form, "subject", "Enter or select a subject.");
      valid = false;
    }
    if (!dueDate) {
      setFieldError(form, "dueDate", "Choose a due date.");
      valid = false;
    }

    if (!valid) {
      const firstInvalid = form.querySelector("[aria-invalid='true']");
      if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
      return;
    }

    saveLock = true;
    const submitBtn = form.querySelector("[data-submit]");
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

    const mode = form.dataset.mode;
    const now = new Date().toISOString();

    if (mode === "edit") {
      const id = form.dataset.id;
      const index = assignments.findIndex((item) => item.id === id);
      if (index === -1) {
        saveLock = false;
        showToast("That assignment could not be found.");
        window.location.hash = "#/assignments";
        return;
      }

      const updated = {
        ...assignments[index],
        title,
        subject,
        dueDate,
        notes,
        updatedAt: now,
      };

      const next = [...assignments];
      next[index] = updated;
      assignments = next;

      if (!persist()) {
        saveLock = false;
        if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
        return;
      }

      showToast("Changes saved.");
      saveLock = false;
      window.location.hash = `#/assignment/${encodeURIComponent(id)}`;
      return;
    }

    const created = {
      id: createId(),
      title,
      subject,
      dueDate,
      notes,
      status: /** @type {"pending"} */ ("pending"),
      createdAt: now,
      updatedAt: now,
    };

    assignments = [...assignments, created];
    if (!persist()) {
      assignments = assignments.filter((item) => item.id !== created.id);
      saveLock = false;
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      return;
    }

    showToast("Assignment saved.");
    saveLock = false;
    window.location.hash = "#/";
  });

  form.querySelector("[data-cancel]")?.addEventListener("click", async () => {
    const current = new FormData(form);
    const dirty = ["title", "subject", "dueDate", "notes"].some(
      (key) => String(current.get(key) || "") !== String(initial.get(key) || "")
    );

    if (dirty) {
      const leave = await confirmDialog({
        title: "Unsaved changes",
        message: "You have unsaved changes. Discard them?",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!leave) return;
    }

    const mode = form.dataset.mode;
    const id = form.dataset.id;
    if (mode === "edit" && id) {
      window.location.hash = `#/assignment/${encodeURIComponent(id)}`;
    } else {
      window.location.hash = "#/assignments";
    }
  });
}

function clearFieldErrors(form) {
  form.querySelectorAll(".field").forEach((field) => field.classList.remove("is-invalid"));
  form.querySelectorAll(".field-error").forEach((error) => {
    error.hidden = true;
    error.textContent = "";
  });
  form.querySelectorAll("input, textarea").forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  });
}

function setFieldError(form, fieldName, message) {
  const field = form.querySelector(`[data-field="${fieldName}"]`);
  const input = form.querySelector(`#${fieldName}`);
  const error = form.querySelector(`#${fieldName}-error`);
  field?.classList.add("is-invalid");
  if (error) {
    error.hidden = false;
    error.textContent = message;
  }
  if (input instanceof HTMLElement) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${fieldName}-error`);
  }
}

function completeAssignment(id) {
  const index = assignments.findIndex((item) => item.id === id);
  if (index === -1) return;
  const next = [...assignments];
  next[index] = {
    ...next[index],
    status: "completed",
    updatedAt: new Date().toISOString(),
  };
  assignments = next;
  if (!persist()) return;
  showToast("Marked as complete.");
  render();
}

function reopenAssignment(id) {
  const index = assignments.findIndex((item) => item.id === id);
  if (index === -1) return;
  const next = [...assignments];
  next[index] = {
    ...next[index],
    status: "pending",
    updatedAt: new Date().toISOString(),
  };
  assignments = next;
  if (!persist()) return;
  showToast("Moved back to pending.");
  render();
}

async function deleteAssignment(id) {
  const ok = await confirmDialog({
    title: "Delete this assignment?",
    message: "Delete this assignment? It will be removed from this browser’s saved list.",
    confirmLabel: "Delete assignment",
    cancelLabel: "Keep assignment",
    danger: true,
  });
  if (!ok) return;

  const previous = assignments;
  assignments = assignments.filter((item) => item.id !== id);
  if (!persist()) {
    assignments = previous;
    return;
  }
  showToast("Assignment deleted.");
  window.location.hash = "#/assignments";
}

function bindDataPage() {
  pendingBackupFile = null;
  const fileInput = /** @type {HTMLInputElement | null} */ (
    mainEl?.querySelector("[data-backup-file]")
  );
  const restoreBtn = /** @type {HTMLButtonElement | null} */ (
    mainEl?.querySelector("[data-backup-restore]")
  );
  const filenameEl = mainEl?.querySelector("[data-backup-filename]");
  const errorEl = /** @type {HTMLElement | null} */ (mainEl?.querySelector("[data-backup-error]"));

  mainEl?.querySelector("[data-backup-download]")?.addEventListener("click", () => {
    const blob = createBackupBlob(assignments);
    const url = URL.createObjectURL(blob);
    const stamp = todayStamp();
    const link = document.createElement("a");
    link.href = url;
    link.download = `student-assignment-tracker-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.");
  });

  fileInput?.addEventListener("change", async () => {
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    pendingBackupFile = null;
    if (restoreBtn) restoreBtn.disabled = true;

    if (!file) {
      if (filenameEl) filenameEl.textContent = "No file chosen yet.";
      return;
    }

    if (filenameEl) filenameEl.textContent = `Selected: ${file.name}`;

    try {
      const text = await file.text();
      const parsed = parseBackupText(text);
      if (!parsed.ok) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = parsed.error;
        }
        return;
      }
      pendingBackupFile = file;
      if (restoreBtn) restoreBtn.disabled = false;
    } catch {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          "Could not read that file. Choose a valid Student Assignment Tracker JSON backup.";
      }
    }
  });

  restoreBtn?.addEventListener("click", async () => {
    if (!pendingBackupFile) return;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    let parsed;
    try {
      const text = await pendingBackupFile.text();
      parsed = parseBackupText(text);
    } catch {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          "Could not read that file. Choose a valid Student Assignment Tracker JSON backup.";
      }
      return;
    }

    if (!parsed.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = parsed.error;
      }
      return;
    }

    const confirmed = await confirmDialog({
      title: "Restore this backup?",
      message: `This will replace the ${assignments.length} assignment${
        assignments.length === 1 ? "" : "s"
      } saved in this browser with ${parsed.data.assignments.length} assignment${
        parsed.data.assignments.length === 1 ? "" : "s"
      } from the backup. This cannot be undone.`,
      confirmLabel: "Restore backup",
      cancelLabel: "Keep current data",
      danger: true,
    });

    if (!confirmed) return;

    const previous = assignments;
    assignments = parsed.data.assignments;
    if (!persist()) {
      assignments = previous;
      return;
    }

    listFilters = { status: "all", subject: "" };
    showToast("Backup restored.");
    window.location.hash = "#/";
  });
}

function todayStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

bootstrap();
})();
