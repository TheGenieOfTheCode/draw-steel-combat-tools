export const SECTION = {
  header: ':is(.message-part-header, .card-target)',
  name: ':is(.targetName, .target-name)',
  rolls: ':is(.message-part-rolls, .card-rolls)',
  buttons: ':is(footer.message-part-buttons, .card-buttons)',
  potency: ':is(.message-part-potency, .card-potency)',
  potencyLine: ':is(.message-part-potency > .flexrow, .card-potency > .potency-row)',
  tierLine: ':is(.message-part-rolls, .card-target-text) > dl.power-roll-display',
};
