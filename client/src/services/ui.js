/**
 * Global UI services, available in every component:
 *
 *   this.$toast.success('Saved')            notifications
 *   await this.$confirm({ title, ... })     confirmation dialog (resolves true/false)
 *   this.$tasks.open(taskId)                live task log viewer
 *
 * The matching components (ToastStack, ConfirmDialog, TaskViewer) are
 * mounted once in App.vue and render this shared state.
 */
import { reactive } from 'vue';

let toastSequence = 0;

export const toastState = reactive({
  items: [],
});

/**
 * Show a toast for a few seconds.
 *
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} message
 * @param {number} [duration]
 */
function pushToast(type, message, duration = 4500) {
  toastSequence += 1;
  const id = toastSequence;

  toastState.items.push({ id, type, message });

  setTimeout(() => {
    dismissToast(id);
  }, duration);
}

export function dismissToast(id) {
  const index = toastState.items.findIndex((item) => item.id === id);

  if (index !== -1) {
    toastState.items.splice(index, 1);
  }
}

export const toast = {
  success(message) {
    pushToast('success', message);
  },
  info(message) {
    pushToast('info', message);
  },
  warning(message) {
    pushToast('warning', message, 7000);
  },
  /**
   * @param {Error|string} error
   */
  error(error) {
    let message = error;

    if (error && error.message) {
      message = error.message;
    }

    pushToast('error', String(message), 8000);
  },
};

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: 'Confirm',
  danger: false,
  requireText: '',
  icon: 'alert-triangle',
  resolve: null,
});

/**
 * Ask for confirmation.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.confirmText]
 * @param {boolean} [options.danger] red confirm button
 * @param {string} [options.requireText] text the user must type to confirm
 * @param {string} [options.icon] feather icon name
 * @returns {Promise<boolean>}
 */
export function confirm(options) {
  return new Promise((resolve) => {
    confirmState.title = options.title;
    confirmState.message = options.message || '';
    confirmState.confirmText = options.confirmText || 'Confirm';
    confirmState.danger = Boolean(options.danger);
    confirmState.requireText = options.requireText || '';
    confirmState.icon = options.icon || 'alert-triangle';
    confirmState.resolve = resolve;
    confirmState.open = true;
  });
}

export function settleConfirm(result) {
  if (confirmState.resolve) {
    confirmState.resolve(result);
  }

  confirmState.open = false;
  confirmState.resolve = null;
}

export const taskViewerState = reactive({
  taskId: null,
  listeners: [],
});

export const tasks = {
  /**
   * Open the live log of a task.
   *
   * @param {number} taskId
   */
  open(taskId) {
    taskViewerState.taskId = taskId;
  },
  close() {
    taskViewerState.taskId = null;
  },
  /**
   * Be notified when any watched task finishes.
   *
   * @param {(task: object) => void} callback
   * @returns {() => void} unsubscribe function
   */
  onFinished(callback) {
    taskViewerState.listeners.push(callback);

    return () => {
      const index = taskViewerState.listeners.indexOf(callback);
      if (index !== -1) {
        taskViewerState.listeners.splice(index, 1);
      }
    };
  },
  notifyFinished(task) {
    for (const callback of taskViewerState.listeners) {
      callback(task);
    }
  },
};
