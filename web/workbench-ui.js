/* Dialog behavior adapted from 21st.dev Scrollable Sheet (25010).
   Native dialog supplies focus trapping, Escape, inert background and focus return. */
(() => {
  const select = document.getElementById('workbench-scene');
  const updateScene = scene => {
    document.body.dataset.activeScene = scene;
    if (['hoop', 'multi', 'chaos'].includes(scene)) select.value = scene;
    document.querySelectorAll('[data-scene]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scene === scene)));
  };
  select.addEventListener('change', () => document.querySelector(`[data-scene="${select.value}"]`)?.click());
  window.addEventListener('twinforge:scene', event => updateScene(event.detail.scene));
  document.querySelectorAll('[data-open-dialog]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.openDialog).showModal());
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  });
  // Keep the chart and source details available without covering the experiment.
  document.querySelector('#evidence-drawer .pad').append(document.getElementById('chart-wrap'));
  for (const id of ['in-angle','in-power','in-spin','in-wind']) {
    document.getElementById(id).previousElementSibling.htmlFor = id;
  }
  for (const id of ['tg-ghost','tg-mc','tg-mpc']) {
    const button = document.getElementById(id);
    const sync = () => button.setAttribute('aria-pressed', String(button.classList.contains('on')));
    new MutationObserver(sync).observe(button, {attributes:true,attributeFilter:['class']}); sync();
  }
  document.addEventListener('DOMContentLoaded', () => updateScene(window.Twinforge?.status?.().scene || 'hoop'));
})();
