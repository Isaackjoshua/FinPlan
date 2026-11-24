# Variable income: findings, proposed changes and plan

Status: **slices 1 and 2 are built; slices 3 to 9 are not started.** Findings were checked against commit
`9b80935`, before slice 1, where all 179 tests passed; line numbers refer to it. Figures marked *reproduced* come from running the real functions
on the grounding case.

Words used here:

- **MCP** (Model Context Protocol): how an AI app calls FinPlan's tools.
- **EF**: emergency fund. **APR**: annual percentage rate, the yearly interest on a debt.
- **Minor units**: the currency's smallest unit. FinPlan treats TZS as having two decimals, so
  TZS 200,000 is stored as `20000000`. Amounts below are whole shillings unless they say minor.
- **Lean / typical / good**: a bad, a middling and a strong month of income.
- **Sinking fund**: money set aside monthly for a big bill that comes less often.
- **Strict schema**: a description of a response that forbids any field it does not list.

## 1. Findings

### The reported gaps

| # | Gap | Verdict | What the code does |
|---|---|---|---|
| P0-1 | Variable income cannot be represented | **Confirmed** | Income is one `amountMinor` + `frequency` (`core/src/schemas.ts:57`), summed into one figure (`core/src/summary.ts:36`). That figure feeds the dashboard, warnings, `get_profile`, lesson suggestions and saved plans. **Corrected:** the `calc_*` tools do not read it; they take whatever numbers the agent passes |
| P0-2 | No warning on an incomplete profile | **Confirmed, reproduced** | Claude + data only: surplus 116,500, `warnings: []`. Income and nothing else: surplus 200,000, `warnings: []`. `profileWarnings` sees only totals, so it cannot know a category is missing |
| P1-1 | `essential` does too much | **Confirmed, reproduced** | All eight lines essential gives 473,500 × 6 = 2,841,000. **Worse than reported:** there are two rules. EF sizing uses the flag; a plan's needs/wants uses a fixed category list and ignores the flag (`core/src/planResults.ts:17`) |
| P1-2 | No timing within the month | **Confirmed** | No due day or arrival date. **Also missing:** any balance of spendable cash, which a cash-flow view has to start from |
| P1-3 | Lumpy bills are smoothed invisibly | **Confirmed, reproduced** | 255,000 quarterly and 85,000 monthly give identical summaries. `get_profile` returns no monthly equivalent per line |
| P1-4 | No allocation model | **Confirmed** | `priority` is stored and displayed, and no calculation reads it. Nor does any read `targetDate` |
| P2-1 | No goal feasibility check | **Confirmed** | `create_goal` validates shape only |
| P2-2 | No multi-item goals | **Confirmed** | One target per goal |
| P2-3 | No totalling tool | **Confirmed, worse** | `calc_budget` takes monthly amounts only, so the agent must divide 255,000 by 3 itself, breaking the no-arithmetic rule |
| P2-4 | EF sizing ignores volatility | **Confirmed** | months × essentials (`calc/src/savings.ts`) |
| P2-5 | No capability discovery | **Confirmed, partly deliberate** | Write tools are listed so that a refused call can ask the user for permission (`scopeChallenge`, `apps/mcp/src/server.ts:93`). Hiding them would break that. The fix is to state permissions early, not hide tools |
| P2-6 | Check-ins do not feed back | **Confirmed** | Stored and compared with the plan, nothing else. **Corrected:** actual income is already recorded per check-in, so measuring needs no new table at first |

### Found while checking

| # | Finding | Why it matters here |
|---|---|---|
| N1 | **A plan ignores the profile's expenses.** *Reproduced:* the full 473,500 profile with an empty budget saves as "200,000 unallocated", no warnings | The same false confidence as P0-2, in the plan itself. P0 |
| N2 | **Adding a field to a response breaks AI apps.** Responses use strict schemas, and the official client rejects a mismatch with the tool list it has cached. Server-side the same check turns the call into an error | Decides the whole API approach (section 2) |
| N3 | **Adding a field to stored items breaks `get_profile`.** It copies every stored field into the strict response (`apps/mcp/src/tools/read.ts:101`) | Must be fixed before anything new is stored. Also makes rolling back past that fix unsafe |
| N4 | **Updating an item replaces all of it.** An older agent correcting a label would silently erase a floor or due date | Updates must keep fields they do not mention |
| N5 | **An agent's check-in cannot be undone**, though the tool says it can (`apps/mcp/src/tools/write.ts:207`) | Must be fixed before check-ins influence a plan |
| N6 | `income_minor` is required in a check-in, and periods may overlap or be any length | "0" can mean "nothing came" or "not told". Measuring needs rules for both |
| N7 | A goal's saved amount and the EF savings balance are unconnected, and a check-in updates neither | A waterfall would count the same money twice |
| N8 | The 30,000 debt at 0% with no payment is reported as "interest grows faster than the payments". *Reproduced.* | False statement, and it hits this user |
| N9 | Cleared debts still count their minimum payment. *Reproduced.* | Understates the surplus |
| N10 | Saved plans stay frozen (correct) but nothing says the profile has since changed | Old confident plans keep looking current |
| N11 | No response tells an agent how many decimals the currency has; the hint says "for example cents" | An agent can record TZS 200,000 as `200000`, which is TZS 2,000.00 |
| N12 | The irregular-income lesson says a 40,000 budget "survives every one of these months"; one month is 38,000 (`content/budgeting.ts:80`) | Wrong advice on exactly this subject |
| N13 | Migrations only run forwards | "Reversible" needs something added (section 2) |

## 2. Proposed data model and API

### Compatibility rules

1. **Existing responses never change shape.** New data comes back only from new tools, or when the
   request uses a new parameter. An app that asks for a new section has necessarily seen the new schema.
2. **New warning codes are safe.** `code` is already free text, so warnings reach every existing app.
   Messages carry no figures; figures come from fields.
3. **Every answer is trimmed to its declared schema at the server boundary** (fixes N3; built in slice 1).
   One filter covers every tool and every level; listing fields by hand missed a nested one.
4. **An update keeps what it does not mention** (fixes N4). `null` clears a field. An old-style change to a
   variable income's amount is refused with an explanation; it is never guessed at.
5. **Old fields keep a safe meaning.** For variable income `amountMinor` is the floor, so older
   code and older agents see the cautious figure.
6. Single-amount profiles produce the same numbers as today, apart from the N8 and N9 fixes.

Considered and rejected: loosening every response schema. It does not help apps holding the old cached list.

### Stored data

Items, goals and plans are encrypted JSON, so most additions need **no SQL migration**.

| Change | Where | SQL? |
|---|---|---|
| Income: `variability?` (`fixed` default, `variable`), `typicalMinor?`, `highMinor?`. `amountMinor` is the floor, so there is no second copy to disagree with it. Monthly only; floor ≤ typical ≤ high; **typical and high may be unknown** | item JSON | No |
| Expense: `tier?` `survival` / `committed` / `discretionary` | item JSON | No |
| Expense: `nextDueDate?` (rolls forward by frequency, so it works for monthly and quarterly), `reservedMinor?` (already set aside) | item JSON | No |
| Income: `arrival?` `{ fromDay, toDay }` | item JSON | No |
| Goal: `fundingOrder?`, `monthlyCapMinor?`, `savingsItemId?` (fixes N7), `parts?` | goal JSON | No |
| Profile: `acknowledgedWarnings?`, for people who really do pay no rent | profile JSON | No |
| Plan results: `scenarios?`, `profileRevision?` (N10). Old versions simply lack them | plan JSON | No |
| `check_ins.voided_at` (N5) | nullable column | **Yes, M1** |
| `income_actuals`: month in clear text, amount and source encrypted, optional check-in, `voided_at` | new table | **Yes, M2** |
| `allocations`: month in clear text, lines encrypted, profile revision, `voided_at` | new table | **Yes, M3** |

Both new tables delete with the account and join the data export. The month in clear text matches what
`check_ins` already does.

**`essential` and `tier`.** No tier: `essential` true means survival, false means discretionary, exactly as
now. With a tier, `essential` is true only for survival. So the existing essentials total becomes
survival-only without changing its field. Existing profiles keep their current EF target until someone
classifies a line; a nudge points at `personal` and `entertainment` lines marked essential.

**`monthly_surplus_minor`.** Stays a plain number, floor-based. The band sits beside it.

**Reversibility.** Every migration is additive and gets a paired down script, tested up, down, up. Ordinary
rollback is redeploying older code and leaving the unused column or table. Running a down script on a table
**deletes its rows**, so it needs a backup first. Code must not be rolled back past slice 1 once new fields
are stored, and older web forms would drop new fields from any item they save.

### Measuring income

- A month is **observed** when check-ins cover every day of it once. Gaps, overlaps and periods crossing a
  month end are excluded, and the reason is returned. The current month never counts.
- Over the last 12 observed months: lean = lowest, typical = median, good = upper quartile.
- Under 3 months: declared only. 3 to 5: shown as provisional. 6 or more: measured figures replace declared.
- A measured month below the declared floor takes effect **at once** and raises a warning.
- Check-ins record total income, so measured figures describe the household, not each source.
- FinPlan never edits the declared profile from a check-in. It shows the difference and the user decides.

`income_actuals` is therefore not needed in P0. It arrives with timing, which needs receipt dates.

### Scenario results

Each of lean, typical and good is either figures or `unknown` with a reason, plus `basis` (`declared`,
`provisional`, `measured`) and months observed. One break-even income is always given. For the grounding case:

| | Lean | Typical | Good |
|---|---|---|---|
| Income | 200,000 | unknown | unknown |
| All monthly costs | 473,500 | 473,500 | 473,500 |
| Result | **short 273,500** | unknown | unknown |
| Survival costs only (330,000) | **short 130,000** | unknown | unknown |

- Break-even: 473,500. A month must reach this to balance.
- The 300,000 saved covers 1.0 lean month in full, or 2.3 of survival spending.
- How often lean months happen: not known.

As built in slice 2: a plan's scenarios also count spending in the profile that its budget leaves out, so an
empty budget still shows the shortfall. With variable income `spending_exceeds_income` and
`plan_exceeds_income` are raised only when a typical month is known to fall short.

### Tools

| Tool | Change | Version risk |
|---|---|---|
| `get_profile` | New sections: `income_band`, `completeness` (built); `line_details`, `obligations`, `cash_flow` | None, opt-in |
| `update_profile` | Optional new item fields | None |
| `save_plan_version`, `get_current_plan`, `get_plan_version` | `include: ['scenarios']`. New warnings always: `lean_month_shortfall`, `income_uncertain`, `plan_omits_expenses` | None, opt-in |
| `create_goal`, `update_goal`, `list_goals` | Optional new fields; `include: ['feasibility', 'parts']`. Also a `goal_unreachable` warning in `get_profile` | None, opt-in |
| `calc_budget`, `calc_savings_projection`, `calc_debt_payoff` | Optional `scenarios` input in place of the scalar; the result names which ran | None, opt-in |
| `calc_emergency_fund` | Optional `volatility` mode | None, opt-in |
| `log_check_in` | Wording fix and the void rule; explicit "no income this month" flag | None |
| New: `calc_totals`, `calc_sinking_fund`, `calc_cash_flow`, `calc_allocation` | Pure calculators | None, additive |
| New: `get_capabilities` | Granted permissions and, with read access, currency decimals plus a worked example (N11). Also stated in the per-connection instructions | None, additive |
| New: `record_allocation` | Write tool, undoable | None, additive |

The engine version is `1.0.1` after slice 1 and is `1.1.0` from slice 2. The count of 19 tools in the
tests changes when tools are added.

### The calculators

- **Sinking fund:** steady monthly amount, plus a catch-up amount when a due date is known:
  (amount − reserved) ÷ whole months left, rounded up. Rent 255,000: steady **85,000**; with nothing reserved
  and two months left, **127,500**. No due date: the steady figure and `due_date_unknown`.
- **Cash flow:** a day-by-day balance from a stated opening amount, with the lowest point and its date. Lean
  income lands on the last day of its window. Undated items are listed and the result is marked partial;
  dates are never invented.
- **Allocation (waterfall):** survival costs, sinking funds, debt minimums, committed costs, then goals in
  order. Each takes up to its cap. Order replaces "depends on". Recording proposes; goal balances move only
  when the user confirms the money moved.
- **Volatility-aware EF:** with history, the worst run of consecutive shortfalls. Without it, lean months
  chosen by the user × the lean survival gap (130,000 each here). Shown beside the months-of-survival figure.

## 3. Implementation plan

Each slice ships alone, with tests, in this order. Sizes are relative.

| Slice | Contents | SQL | Size |
|---|---|---|---|
| **1. Stop misleading people (P0)** | Compatibility rules 3 and 4 (N3, N4). Completeness warnings. Dashboard shows "not enough information yet" in place of a green surplus. `plan_omits_expenses` (N1). Fix N8, N9, N12 | None | S |
| **2. Declared variable income (P0)** | Income type, band, break-even, plan scenarios, scenario inputs on `calc_*`, profile form, dashboard and plan views | None | L |
| **3. Measured income (P0, was P2-6)** | M1 and voiding check-ins (N5). Observed months (N6). Declared against actual. Plan-is-stale notice (N10) | M1 | M |
| **4. Expense tiers (P1)** | `tier`, one needs rule everywhere, EF view of what is and is not protected | None | M |
| **5. Lumpy obligations (P1)** | Due dates, reserves, sinking funds, visible normalisation wherever a figure was smoothed | None | M |
| **6. Timing (P1)** | Arrival windows, dated receipts, cash-flow view | M2 | L |
| **7. Waterfall (P1)** | Funding order and caps, goal-to-savings link (N7), allocation record | M3 | L |
| **8. Agent tools (P2)** | `get_capabilities`, `calc_totals` | None | S |
| **9. Goals and EF (P2)** | Feasibility, multi-part goals, volatility-aware EF | None | M |

**Smallest shippable slice: 1.** No migration, undone by a redeploy, and every existing AI app benefits
immediately through `warnings`. It stores one new thing: the user's answers to completeness checks, in the
encrypted profile, which earlier code ignores. P2-6 moves to slice 3 because "measured, not declared" depends
on it.

### Completeness checks in slice 1

All need recorded income. The user can answer each one ("I pay nothing for housing") and take it back; agents
cannot. A mortgage counts as housing. With a real shortfall the surplus check stays quiet, because no surplus
is being claimed.

| Code | Fires when |
|---|---|
| `no_housing_recorded`, `no_food_recorded` | No expense in that category |
| `expenses_look_low` | Expenses and minimum debt payments under 30% of income |
| `surplus_unreliable` | A positive surplus with fewer than three expense lines, or any check above still open |

### Acceptance tests

One shared fixture: the grounding case in minor units (TZS, two decimals), gym, Claude and
internet/data `committed`, the other five lines `survival`.

| Test | Expected (whole TZS) | Slice |
|---|---|---|
| Income, no housing or food | `warnings` non-empty: both codes and `surplus_unreliable` | 1 |
| Full profile, empty plan budget | `plan_omits_expenses` | 1 |
| 0% debt, no payment | Warned as never cleared, with no mention of interest | 1 |
| Old-style update of an item holding new fields | New fields survive | 1 |
| **Every existing tool called by a client holding today's schemas** (saved as a snapshot) | All responses validate, in every slice | 1 onwards |
| Floor 200,000, costs 473,500 | Lean short 273,500; typical and good `unknown`; break-even 473,500; `income_uncertain` | 2 |
| Same profile as fixed income | Same numbers as today | 2 |
| Six observed months, one under the floor | Measured band; warning; declared profile untouched | 3 |
| Overlapping, partial or voided check-ins | Month not counted, with the reason | 3 |
| EF, 6 months | Survival 330,000 a month: **1,980,000**, not 2,841,000; committed 143,500 shown as not covered | 4 |
| Quarterly rent 255,000 | Listed as lumpy; set-aside 85,000; 127,500 with two months left | 5 |
| Month nets positive, rent due before income | Trough date and amount returned | 6 |
| Waterfall | Parts sum exactly to the amount available, for any input | 7 |
| Goal 2,841,000 against a shortfall | Created, flagged unreachable | 9 |
| Goal parts 200,000 + 150,000 + 200,000 | Server total 550,000 | 9 |

The calculation package keeps its 100% coverage rule.

## 4. Decisions (24 November 2026)

1. **Stored amounts are right.** The dashboard shows TZS 200,000.00. N11 stays worth fixing in slice 8.
2. **Survival** is everything but gym, Claude and internet/data.
3. **Measured income:** provisional at 3 months, measured at 6, lean = the lowest month.
4. **Waterfall:** committed costs come after sinking funds and debt minimums.
5. **Six-monthly frequency:** yes, in slice 5, knowing that older AI apps may reject it for users who choose it.
6. **Slice 1 approved** on its own.
