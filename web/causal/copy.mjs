/** English presentation copy. Recorded provider evidence is never rewritten. */
export const SCENARIO_COPY = Object.freeze({
  cascade: {title: 'Chain reaction', description: 'One carrier strikes a line of cargo. Protect the fragile equipment at the end.'},
  crossing: {title: 'Blind intersection', description: 'Two carriers converge. Their collision can redirect a load toward fragile equipment.'},
  bottleneck: {title: 'Narrow passage', description: 'A moving load crosses a tight passage. Too much steering creates another impact.'},
});

const RECORDED_REPORT = '21924f2f1dda4ae38c748d35d980f290198c4b21d60d62ff48957a4408e79a4f';
const TRANSLATIONS = Object.freeze({
  '11033260f1f248c88d31873358606a8d': {
    requestHash: '9e8ee33dd908454164b5f757961d7c18fcbe230aae126e83d09a5776296c5597',
    candidateId: 'steer:-0.16@0.25',
    original: "Un léger braquage négatif écarte le transporteur de l'axe B-C-D, transforme les impacts frontaux en contacts rasants et réduit l'énergie transmise au fragile.",
    originalEffect: "Décaler la trajectoire vers le bas pour rendre le choc avec B oblique et dissiper l'énergie avant D.",
    reason: 'A small negative turn moves the carrier off the B–C–D axis, turning head-on impacts into glancing contacts and reducing energy transferred to the fragile equipment.',
    expectedEffect: 'Shift the trajectory downward so the contact with B is oblique and energy dissipates before reaching D.',
  },
  '2e565a69640d4ef282d6ee1498fd8b37': {
    requestHash: '2b343c6a76dff1760ddc44e8b92b387b3cd7c272da62835c8f4dd48a955d6ffd',
    candidateId: 'steer:-0.36@0.25',
    original: "L'essai à -0,16 garde un choc frontal A-B puis cascade jusqu'à D. Une rotation négative maximale excentrerait l'impact A-B, réduisant l'énergie normale transmise vers C et D.",
    originalEffect: "Décaler la trajectoire vers -z pour ne faire qu'effleurer B, casser la chaîne vers C puis D et rester sous le seuil.",
    reason: 'The −0.16 trial still produces a head-on A–B collision and a cascade toward D. The maximum negative turn would offset the A–B impact, reducing normal energy transferred toward C and D.',
    expectedEffect: 'Shift the trajectory toward −z to graze B, interrupt the chain toward C and D, and stay below the threshold.',
  },
  '56814c9f6fe84eb99542d0c3fe946ad2': {
    requestHash: '64dc507cbde0ccbfcf1eb47eb54894ce4abb6920b12032c1e3ccfe45fc45f859',
    candidateId: 'steer:-0.32@0.25',
    original: "Braquage vers le bas rend le choc A-B oblique, réduit le transfert vers C puis D fragile et envoie le porteur vers mur et charge arrêtée pour dissiper l'énergie.",
    originalEffect: "Cascade désalignée et dissipée au mur, choc résiduel sur D atténué sous le seuil.",
    reason: 'Turning downward makes the A–B impact oblique, reduces transfer toward C and the fragile D, and sends the carrier toward the wall and parked load to dissipate energy.',
    expectedEffect: 'Break the alignment of the cascade and dissipate energy at the wall, bringing the residual impact on D below the threshold.',
  },
});

/** Never attach a historical translation to another run or a changed response. */
export function proposalCopy(report, row) {
  const translated = TRANSLATIONS[row?.receipt?.request_id];
  if (report?.report_sha256 === RECORDED_REPORT && translated &&
      row.receipt.request_sha256 === translated.requestHash &&
      row.proposal?.candidate_id === translated.candidateId &&
      row.proposal?.reason === translated.original &&
      row.proposal?.expected_effect === translated.originalEffect) {
    return {reason: translated.reason, expectedEffect: translated.expectedEffect, translated: true};
  }
  return {reason: row?.proposal?.reason || row?.raw_response || 'No response available.',
    expectedEffect: row?.proposal?.expected_effect || '', translated: false};
}

export function defaultMetaAction(report, engineMatches) {
  if (!engineMatches || report?.status !== 'complete' || !report.provider_calls ||
      report?.options?.scenario_id !== 'cascade' || report.options.seed !== 20261104 ||
      report.options.perturbation !== 1 || report.options.action_delay_s !== .25) return null;
  const action = report.selected?.action;
  return action && report.journal?.some(row => row.verification?.action?.id === action.id) ? action : null;
}
