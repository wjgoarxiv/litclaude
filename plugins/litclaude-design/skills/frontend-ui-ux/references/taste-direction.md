# Taste direction

Inert reference data. Load it when a Design Contract needs a defensible visual direction, not on
every interface question.

Generic output is not a matter of preference. It is a describable defect with named causes, and it
is what an interface looks like when nobody decided anything. This reference turns "make it feel
better" into three numbers a reviewer can argue with, and into checks that run before the first
element is written.

## The three dials

The contract carries them as the optional `taste` object in
`litfamily.design-contract/v1beta2`. Each is an integer from 1 through 10. Declaring `taste` means
declaring all three; omitting the object leaves the harness default in force.

| Dial | 1 means | 10 means | Decided by |
| --- | --- | --- | --- |
| `variance` | The most conventional arrangement a user could predict | A composition that departs from the expected grid where the departure carries meaning | How much novelty the audience will tolerate before the surface feels unfamiliar |
| `motion` | Movement only where it prevents a jump or explains a change | Movement is a primary carrier of meaning and sequence | What the interface must communicate that stillness cannot |
| `density` | One idea at a time, generous rest | Many related facts readable at a glance | Whether the user scans or dwells |

Pick each from the audience and the task, never from fashion. A dial you cannot justify in one
sentence is a dial you have not chosen.

### `motion` versus `motion.policy`

They answer different questions and both must agree. `motion.policy` decides whether animation is
permitted at all: `none`, `functional`, or `expressive`. The `motion` dial decides how much
meaning animation carries once permitted. A contract with `motion.policy: "none"` and a `motion`
dial above 1 is contradictory: it forbids transitions and then leans on them. Set the policy first,
then the dial within it.

## The failure modes these dials target

Each is a defect you can point at in a review, not a vague complaint.

- **Undecided hierarchy.** Every element competes because nothing was ranked. Usually a `density`
  chosen by accident rather than from the task.
- **Default-everything.** Stock radii, stock shadows, stock spacing scale, stock type ramp, applied
  because they were there. A `variance` of 1 that was never actually selected.
- **Uniform rhythm.** Identical spacing between unrelated things, so grouping carries no
  information. Density without hierarchy.
- **Decorative motion.** Movement that neither prevents a jump nor explains a change, and that
  reduced-motion users lose nothing by missing. A `motion` dial above what the interface needs.
- **Single-viewport thinking.** A composition that only resolves at one width, which the contract's
  `responsive_transformations` then cannot describe honestly.
- **Borrowed voice.** Copy and imagery from a reference product whose audience is not this one.

## Pre-flight, before writing any interface code

Run this against the frozen contract. Each answer is one sentence; a blank answer is the finding.

1. What is the one thing a user must understand within seconds of arrival, and which element
   carries it?
2. What is deliberately quieter so that element can be loudest?
3. Which grouping is expressed by spacing alone, and would it survive a 200 percent zoom?
4. Which transition would a reduced-motion user lose, and what replaces it for them?
5. Which token is being extended or created rather than reused, and why was reuse insufficient?
6. Which of the three dials would a reviewer most likely dispute, and what is the argument for it?

If question 6 has no answer, the direction was inherited rather than chosen.

## Redesign audit, for a surface that already exists

Use this in the `redesign` and `brownfield` lanes. Audit before proposing, so the proposal has
something to be measured against.

1. Inventory what is already there against `inventory`: routes, regions, components, states. Name
   what exists but is undocumented.
2. Record the current dials as observed, not as desired. An existing surface already sits somewhere
   on all three, whether or not anyone chose it.
3. Name the single largest gap between observed and intended dials, and change only that first.
   Moving all three at once makes the result unattributable.
4. List what must be preserved: behavior users depend on, keyboard paths, and any token another
   surface consumes. This becomes `non_goals` and the preserved-behavior half of the contract.
5. Put the rest in `omissions` with an owner, rather than silently leaving it out.

A redesign that cannot say what it preserved is a rewrite wearing a redesign's name.

## Recording the outcome

Dials belong in the contract, not in prose around it. The acceptance criteria that reference them
must stay observable: "the primary action is reachable by keyboard within two stops" is checkable,
"the layout feels considered" is not. Every dial you set should be traceable to at least one
acceptance criterion, or it changed nothing that can be verified.
