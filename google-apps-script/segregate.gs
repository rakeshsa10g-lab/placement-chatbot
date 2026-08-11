/**
 * Files each escalated question into a per-department tab of the response sheet.
 *
 * Paste this into the response spreadsheet:
 *   Extensions → Apps Script → replace everything → Save
 *   Then: Triggers (clock icon) → Add Trigger
 *         function: onFormSubmit | source: From spreadsheet | type: On form submit
 *
 * Full walkthrough: ESCALATION-SETUP.md in the project.
 *
 * Behaviour: a submission from CH23B043 lands in a tab named "CH - Chemical
 * Engineering". Unknown or malformed roll numbers go to "Unsorted" so nothing is
 * ever silently lost. The original "Form Responses 1" tab keeps every row too, so
 * you always have one complete list.
 */

// Roll-number prefix → department name. Edit to match your institute.
var DEPARTMENTS = {
  AE: 'Aerospace Engineering',
  AM: 'Applied Mechanics',
  BS: 'Biological Sciences',
  BT: 'Biotechnology',
  CE: 'Civil Engineering',
  CH: 'Chemical Engineering',
  CS: 'Computer Science & Engineering',
  CY: 'Chemistry',
  ED: 'Engineering Design',
  EE: 'Electrical Engineering',
  EP: 'Engineering Physics',
  HS: 'Humanities & Social Sciences',
  MA: 'Mathematics',
  ME: 'Mechanical Engineering',
  MM: 'Metallurgical & Materials Engineering',
  MS: 'Management Studies',
  NA: 'Ocean Engineering',
  PH: 'Physics'
};

var UNSORTED_TAB = 'Unsorted';

/** Runs automatically on every form submission. */
function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet();                    // "Form Responses 1"
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = e.range.getValues()[0];

    var roll = String(pickColumn(headers, row, ['roll']) || '').trim();
    var code = parseDeptCode(roll);
    var tabName = code && DEPARTMENTS[code]
      ? code + ' - ' + DEPARTMENTS[code]
      : UNSORTED_TAB;

    var target = getOrCreateTab(sheet.getParent(), tabName, headers);
    target.appendRow(row);

    // Newest first is easier to work through during a busy week.
    if (target.getLastRow() > 2) {
      target.sort(1, false);
    }
  } catch (err) {
    // Never let an error here block the submission — the row is already safe
    // in the main responses tab.
    console.error('segregate.gs failed: ' + err);
  }
}

/** First two letters of a roll number like CH23B043. */
function parseDeptCode(roll) {
  var m = String(roll).trim().toUpperCase().match(/^([A-Z]{2})\s*\d{2}/);
  return m ? m[1] : null;
}

/** Find a value by fuzzy header name, e.g. 'roll' matches 'Roll Number'. */
function pickColumn(headers, row, keywords) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase();
    for (var k = 0; k < keywords.length; k++) {
      if (h.indexOf(keywords[k]) !== -1) return row[i];
    }
  }
  return null;
}

/** Get the department tab, creating it with the same headers if needed. */
function getOrCreateTab(spreadsheet, name, headers) {
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.appendRow(headers);
    tab.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    tab.setFrozenRows(1);
  }
  return tab;
}

/**
 * OPTIONAL — run this once by hand to sort submissions that arrived before the
 * trigger was installed. Select 'backfillExisting' in the toolbar and press Run.
 */
function backfillExisting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheets()[0]; // the form responses tab
  var data = source.getDataRange().getValues();
  if (data.length < 2) return;

  var headers = data[0];
  var moved = 0;
  for (var r = 1; r < data.length; r++) {
    var roll = String(pickColumn(headers, data[r], ['roll']) || '').trim();
    var code = parseDeptCode(roll);
    var tabName = code && DEPARTMENTS[code] ? code + ' - ' + DEPARTMENTS[code] : UNSORTED_TAB;
    getOrCreateTab(ss, tabName, headers).appendRow(data[r]);
    moved++;
  }
  SpreadsheetApp.getUi().alert('Backfilled ' + moved + ' response(s) into department tabs.');
}
