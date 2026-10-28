/**
 * Browser localStorage persistence for Student Assignment Tracker.
 * Records belong to this browser/device profile only.
 */
(function () {
  const STORAGE_KEY = "student-assignment-tracker.v1";
  const BACKUP_VERSION = 1;

  function validateAssignment(item, index) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `Assignment ${index + 1} is not valid.` };
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const subject = typeof item.subject === "string" ? item.subject.trim() : "";
    const dueDate = typeof item.dueDate === "string" ? item.dueDate.trim() : "";
    const notes = typeof item.notes === "string" ? item.notes : "";
    const status =
      item.status === "completed" ? "completed" : item.status === "pending" ? "pending" : "";
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;

    if (!id) return { ok: false, error: `Assignment ${index + 1} is missing an id.` };
    if (!title) return { ok: false, error: `Assignment ${index + 1} is missing a title.` };
    if (!subject) return { ok: false, error: `Assignment ${index + 1} is missing a subject.` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return { ok: false, error: `Assignment ${index + 1} has an invalid due date.` };
    }
    if (!status) return { ok: false, error: `Assignment ${index + 1} has an invalid status.` };

    return {
      ok: true,
      data: {
        id,
        title: title.slice(0, 120),
        subject,
        dueDate,
        notes,
        status,
        createdAt,
        updatedAt,
      },
    };
  }

  function validateStorePayload(value) {
    if (!value || typeof value !== "object") {
      return { ok: false, error: "Backup file is not valid JSON data for this planner." };
    }

    if (value.version !== BACKUP_VERSION) {
      return {
        ok: false,
        error: "This backup file is not a recognised Student Assignment Tracker backup.",
      };
    }

    if (!Array.isArray(value.assignments)) {
      return { ok: false, error: "Backup file is missing an assignments list." };
    }

    const assignments = [];

    for (let i = 0; i < value.assignments.length; i += 1) {
      const checked = validateAssignment(value.assignments[i], i);
      if (!checked.ok) return checked;
      assignments.push(checked.data);
    }

    return {
      ok: true,
      data: {
        version: BACKUP_VERSION,
        assignments,
      },
    };
  }

  function loadAssignments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        return { ok: true, data: [] };
      }

      const parsed = JSON.parse(raw);
      const validated = validateStorePayload(parsed);
      if (!validated.ok) {
        return {
          ok: false,
          error:
            "Saved data looked incomplete or damaged, so the planner started with an empty list. You can restore from a backup on Your Data.",
          data: [],
        };
      }

      return { ok: true, data: validated.data.assignments };
    } catch (error) {
      return {
        ok: false,
        error:
          "This browser could not read saved assignments. The planner opened with an empty list. Check browser storage settings, or restore from a backup on Your Data.",
        data: [],
      };
    }
  }

  function saveAssignments(assignments) {
    try {
      const payload = {
        version: BACKUP_VERSION,
        assignments,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return { ok: true };
    } catch (error) {
      const message =
        error && typeof error === "object" && error.name === "QuotaExceededError"
          ? "Could not save because this browser’s storage is full. Free some space or remove old data, then try again."
          : "Could not save assignments in this browser. Your latest change was not stored.";
      return { ok: false, error: message };
    }
  }

  function createBackupBlob(assignments) {
    const payload = {
      product: "Student Assignment Tracker",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      assignments,
    };
    return new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
  }

  function parseBackupText(text) {
    try {
      const parsed = JSON.parse(text);
      return validateStorePayload(parsed);
    } catch (error) {
      return {
        ok: false,
        error: "Could not read that file. Choose a valid Student Assignment Tracker JSON backup.",
      };
    }
  }

  function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  window.SATStorage = {
    loadAssignments,
    saveAssignments,
    validateStorePayload,
    createBackupBlob,
    parseBackupText,
    createId,
  };
})();
