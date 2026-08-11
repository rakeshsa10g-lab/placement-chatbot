# Escalation setup — Google Form → per-department sheets

When the bot can't answer, the student fills a short form inside the chat widget.
It goes to **one Google Form**, and an Apps Script files each response into the
sheet tab for that student's department, based on the roll number.

```
Student asks something the documents don't cover
        │
        ▼
Widget shows: "Enter your roll number"      CH23B043
        │
        ▼
Submitted to ONE Google Form  (roll number + question + department)
        │
        ▼
Google Sheet — Apps Script sorts by roll prefix
        │
        ├── "Form Responses 1"            ← every response, complete list
        ├── "CH - Chemical Engineering"   ← CH23B043 lands here
        ├── "CS - Computer Science & Engineering"
        └── "Unsorted"                    ← unrecognised roll numbers
```

Total time: about 15 minutes. Everything here is free.

---

## Step 1 — Create the Google Form (5 min)

1. Go to **forms.google.com** → **Blank form**
2. Name it something like *Placement Query Escalation*
3. Add **three Short answer questions, in this order**, named exactly:

   | # | Question title |
   |---|---|
   | 1 | `Roll Number` |
   | 2 | `Question` |
   | 3 | `Department` |

   (Only the *Roll Number* title really matters — the Apps Script looks for a column
   containing the word "roll". Keep the others sensible anyway.)

4. **Settings** (gear icon) → make sure **"Limit to 1 response"** is **OFF**, and
   *"Collect email addresses"* is off unless you want it.

## Step 2 — Get the pre-filled link (3 min)

This is how we learn the form's internal field IDs without you touching any code.

1. In the form, click the **⋮** menu (top right) → **Get pre-filled link**
2. Fill the three boxes with these **exact** words, in capitals:

   | Field | Type exactly |
   |---|---|
   | Roll Number | `ROLLNUMBER` |
   | Question | `QUESTION` |
   | Department | `DEPARTMENT` |

3. Click **Get link** at the bottom → **COPY LINK**

## Step 3 — Configure the widget (1 min)

In PowerShell, inside the project folder, paste the link inside quotes:

```
npm.cmd run setup-form -- "PASTE_THE_LINK_HERE"
```

It prints the form address and the three field IDs it found, and writes them into
`public/routing.json`. If it complains that a field is missing, redo Step 2 and check
the dummy words are typed exactly, with no extra spaces.

## Step 4 — Create the response sheet (1 min)

1. In the form, open the **Responses** tab
2. Click the green **Sheets** icon → **Create a new spreadsheet** → **Create**

A spreadsheet opens with a tab called *Form Responses 1*. Leave it open.

## Step 5 — Install the sorting script (5 min)

1. In that spreadsheet: **Extensions** → **Apps Script**
2. Delete whatever is in the editor
3. Open `google-apps-script/segregate.gs` from this project, copy **everything**,
   paste it in
4. Edit the `DEPARTMENTS` list near the top so the codes and names match your
   institute. Delete any you don't use.
5. Click the **💾 Save** icon
6. Click the **⏰ Triggers** icon (left sidebar) → **+ Add Trigger** (bottom right):

   | Setting | Choose |
   |---|---|
   | Which function to run | `onFormSubmit` |
   | Select event source | **From spreadsheet** |
   | Select event type | **On form submit** |

7. **Save**. Google will ask you to authorise it — choose your account →
   **Advanced** → **Go to (project name)** → **Allow**.
   (This warning is normal for personal scripts; the script only touches this sheet.)

## Step 6 — Test it (2 min)

1. Run `npm.cmd run dev`, open http://localhost:3000
2. Ask something the documents don't cover, e.g.
   *"My CGPA is 5.2, can I get a special exception?"*
3. When the orange card appears, type `CH23B043` and click **Send**
4. Check the spreadsheet — a new tab **"CH - Chemical Engineering"** should appear
   with the row in it

Then publish it:

```
git add -A
git commit -m "escalation form"
git push
```

---

## Notes

**Nothing breaks before setup.** Until `form.actionUrl` is filled in, the widget keeps
using the plain "Contact a coordinator" link from `data-escalate-url`.

**Every response is kept twice** — once in *Form Responses 1* (the complete list) and
once in the department tab. Deleting a department tab loses nothing.

**Unrecognised roll numbers** (PhD formats, typos, exchange students) go to an
**Unsorted** tab rather than being dropped.

**Responses that arrived before you installed the trigger** can be filed retroactively:
in the Apps Script editor, pick `backfillExisting` from the function dropdown and press
**Run**.

**Privacy:** the roll number is typed in the browser and posted straight to Google
Forms. It never touches the chatbot server and is never stored by it.

**Want coordinators notified by email too?** In the spreadsheet's *Responses* tab of
the form, click **⋮** → **Get email notifications for new responses**. Or add a
`MailApp.sendEmail(...)` line inside `onFormSubmit` in the Apps Script.
