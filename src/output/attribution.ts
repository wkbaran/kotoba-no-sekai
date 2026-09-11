// Data-source credits shown at the foot of every published page. The EDRDG
// licence (CC BY-SA 4.0) requires an acknowledgement on each page that shows
// JMdict data, with links to the project and licence; Jisho asks API users to
// credit it; JLPT levels come from Jonathan Waller's lists via Jisho.
// Wording follows EDRDG's sample acknowledgement (edrdg.org/edrdg/sample.html).

const JMDICT_URL  = 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project';
const EDRDG_URL   = 'https://www.edrdg.org/';
const LICENCE_URL = 'https://www.edrdg.org/edrdg/licence.html';
const JISHO_URL   = 'https://jisho.org/';
const JLPT_URL    = 'https://www.tanos.co.uk/jlpt/';

export const ATTRIBUTION_HTML =
  `<p class="attribution">This site uses the <a href="${JMDICT_URL}">JMdict/EDICT</a> dictionary files, ` +
  `looked up via <a href="${JISHO_URL}">Jisho.org</a>. These files are the property of the ` +
  `<a href="${EDRDG_URL}">Electronic Dictionary Research and Development Group</a>, and are used in ` +
  `conformance with the Group's <a href="${LICENCE_URL}">licence</a>. ` +
  `JLPT levels from <a href="${JLPT_URL}">Jonathan Waller's JLPT Resources</a>.</p>`;

export const ATTRIBUTION_CSS = '.attribution { margin-top: .4rem; } .attribution a { color: inherit; }';

export const ATTRIBUTION_MARKDOWN =
  `*This site uses the [JMdict/EDICT](${JMDICT_URL}) dictionary files, looked up via [Jisho.org](${JISHO_URL}). ` +
  `These files are the property of the [Electronic Dictionary Research and Development Group](${EDRDG_URL}), ` +
  `and are used in conformance with the Group's [licence](${LICENCE_URL}). ` +
  `JLPT levels from [Jonathan Waller's JLPT Resources](${JLPT_URL}).*`;
