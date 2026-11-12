/**
 * Remind to restart a running project after its DB_* variables changed.
 *
 * @param {object} component a component with a `project` prop (uses $toast)
 */
export function suggestRestart(component) {
  if (component.project.process) {
    component.$toast.info('Restart the project to apply the new variables.');
  }
}
