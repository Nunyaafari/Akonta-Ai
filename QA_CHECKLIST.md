# Akonta AI QA Checklist

## Dashboard + Reports Merge
- Open app and sign in/onboard.
- Go to `Dashboard`.
- Confirm `Overview` and `Reports` toggle appears.
- Switch from `Overview` to `Reports` and back multiple times.
- Confirm no blank screen or crash.
- Confirm old `Reports` route now lands in dashboard reports tab.

## Period Switching Reliability
- In `Dashboard -> Reports`, choose `Month`.
- Switch to previous month and verify period label and totals change.
- Switch back to current month and verify data appears (no empty state regression).
- Repeat with multiple month hops (`Prev`, `Next`).
- Switch to `Year` and verify annual aggregation appears.

## Statement Output
- In reports tab, click `Print / Save PDF` and verify:
  - period title matches selected period
  - totals match on-screen period totals
  - accountant note and signature lines render
- Click `Download Statement` and open file:
  - business name, period, and totals are correct

## Chat Classification Flow
- Start a daily logging flow in chat.
- Verify bot asks for:
  - sales amount
  - sales type (`cash sale`, `MoMo sale`, `credit sale`, `debtor recovery`, etc.)
  - expense amount
  - expense type (`operating expense`, `stock purchase`, `owner withdrawal`, etc.)
  - expense category when required
- Confirm draft summary includes transaction types.
- Reply `SAVE` and verify transactions are confirmed and summary updates.

## Regression Basics
- Bottom nav `Home` returns to landing page.
- History view still loads and shows transactions.
- Settings budget save still works and does not break report rendering.
