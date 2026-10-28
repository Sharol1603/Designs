/**
 * Date and status rules from the PRD.
 * - Completed: status is Completed (even if due date is past)
 * - Overdue: Pending + due date earlier than today's local calendar date
 * - Pending/upcoming: Pending + due date today or later
 * - Due today may be highlighted but is not a separate status
 */
(function () {
  function todayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getDisplayStatus(dueDate, status) {
    if (status === "completed") return "completed";
    if (dueDate < todayLocalISO()) return "overdue";
    return "pending";
  }

  function isDueToday(dueDate, status) {
    return status === "pending" && dueDate === todayLocalISO();
  }

  function getCounts(assignments) {
    let pending = 0;
    let overdue = 0;
    let completed = 0;

    for (const item of assignments) {
      const display = getDisplayStatus(item.dueDate, item.status);
      if (display === "completed") {
        completed += 1;
      } else {
        pending += 1;
        if (display === "overdue") overdue += 1;
      }
    }

    return {
      total: assignments.length,
      pending,
      overdue,
      completed,
    };
  }

  function formatDueDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || "";
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function filterAssignments(assignments, statusFilter, subjectFilter) {
    const subject = subjectFilter.trim().toLowerCase();

    return assignments.filter((item) => {
      const display = getDisplayStatus(item.dueDate, item.status);
      let statusOk = true;

      if (statusFilter === "pending") {
        statusOk = item.status === "pending";
      } else if (statusFilter === "overdue") {
        statusOk = display === "overdue";
      } else if (statusFilter === "completed") {
        statusOk = display === "completed";
      }

      const subjectOk = !subject || item.subject.toLowerCase() === subject;
      return statusOk && subjectOk;
    });
  }

  function sortAssignments(assignments) {
    return [...assignments].sort((a, b) => {
      const aDisplay = getDisplayStatus(a.dueDate, a.status);
      const bDisplay = getDisplayStatus(b.dueDate, b.status);

      if (aDisplay === "overdue" && bDisplay === "overdue") {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (aDisplay === "pending" && bDisplay === "pending") {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (aDisplay === "completed" && bDisplay === "completed") {
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      }

      const order = { overdue: 0, pending: 1, completed: 2 };
      return order[aDisplay] - order[bDisplay];
    });
  }

  function getUpcoming(assignments) {
    const upcoming = assignments.filter(
      (item) => getDisplayStatus(item.dueDate, item.status) === "pending"
    );
    return sortAssignments(upcoming);
  }

  function getOverdue(assignments) {
    const overdue = assignments.filter(
      (item) => getDisplayStatus(item.dueDate, item.status) === "overdue"
    );
    return sortAssignments(overdue);
  }

  function uniqueSubjects(assignments) {
    const set = new Set();
    for (const item of assignments) {
      const subject = item.subject.trim();
      if (subject) set.add(subject);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  function statusLabel(displayStatus) {
    if (displayStatus === "overdue") return "Overdue";
    if (displayStatus === "completed") return "Completed";
    return "Pending";
  }

  window.SATStatus = {
    todayLocalISO,
    getDisplayStatus,
    isDueToday,
    getCounts,
    formatDueDate,
    filterAssignments,
    sortAssignments,
    getUpcoming,
    getOverdue,
    uniqueSubjects,
    statusLabel,
  };
})();
