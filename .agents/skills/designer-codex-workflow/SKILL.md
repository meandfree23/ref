---
name: designer-codex-workflow
description: Use when Codex is asked to act as a designer, create or iterate product UI, follow a design system, use Figma/Mobbin/design inspiration, or turn visual feedback annotations into frontend changes.
---

# Designer Codex Workflow

Use this workflow when design quality, design context, and visual iteration matter. It complements `image-first-frontend`: this skill governs the full designer setup and feedback loop; `image-first-frontend` governs image-reference-to-code implementation.

## Setup Context Before Building

1. Read the project `AGENTS.md`.
2. Identify or ask for:
   - product goal
   - audience
   - platform and screen sizes
   - visual style
   - brand/design-system rules
   - accessibility constraints
   - must-have pages, states, and flows
3. If no design system exists, propose a compact one before implementation:
   - type scale
   - spacing scale
   - color roles
   - component tone
   - motion rules
4. Keep inspiration references consistent with the requested style. Do not mix contradictory prompts such as "dark brutalist" with a light minimalist reference without calling it out.

## Tool Choice

- Use Figma when the user provides a Figma file, wants editable design output, or asks to sync design and code.
- Use Mobbin or another design-pattern MCP only if it is installed/authorized. Treat it as inspiration, not a source to copy.
- Use browser/in-app annotations when the user wants precise visual fixes on a rendered page.
- Use `image-first-frontend` when the visual direction is unclear, when a comp/screenshot exists, or when code should match a reference.
- Use regular code workflow for small functional changes.

## First Prompt Pattern

For a new UI build, assemble the first implementation request with:

- explicit page/screen list
- desktop and mobile expectations
- reference image or design-system summary
- required states such as empty, loading, error, success
- instruction to preserve real text/controls as DOM
- instruction to verify responsive behavior

Prefer one strong first prompt over many vague prompts, but split unrelated requirements into follow-up prompts.

## Visual Iteration Loop

1. Build the first version.
2. Open the page in browser.
3. Review desktop and mobile widths.
4. Use precise feedback:
   - target area or element
   - desired visual change
   - constraint not to break nearby layout
   - state or breakpoint where issue appears
5. Fix one cluster of visual issues at a time.
6. Re-check the same route after changes.

If browser annotations are available, use them for exact visual feedback. If not, describe the target with screenshot, selector, text label, or section name.

## Responsive QA

Responsive behavior is not optional. Check:

- mobile, tablet, and desktop breakpoints
- navigation collapse
- text wrapping and truncation
- image crop behavior
- tap target size
- card/list density
- empty and error states

Add these expectations to `AGENTS.md` or the first prompt when a project often misses them.

## Design Review Criteria

- Does the result follow the stated design system?
- Does it avoid generic AI UI patterns?
- Are hierarchy, rhythm, typography, and spacing intentional?
- Are line-height, letter density, bold scale, and text box width tuned instead of left to default wrapping?
- Do hand-drawn marks have believable line quality through pressure, overlap, roughness, and restraint?
- Are inspiration references used as style direction rather than copied?
- Is the UI usable, accessible, and responsive?
- Are important visuals inspectable instead of obscured by overlays?
- Are deployment or external publishing steps explicitly authorized?

## Editorial Aesthetic Checks

- Use the project aesthetic guide, if present. In this harness, read `.codex/design-aesthetic-rules.md` for typography, spacing, hierarchy, and drawing-line quality.
- Big type should be manually line-broken. Do not allow automatic wrapping to split a word unless the reference intentionally does it.
- Use three clear type weights/scales at most: hero, section, annotation/body.
- Treat marker lines as drawn marks: layer 2-4 imperfect strokes rather than one perfect vector.
- Review the output as a reduced montage; if the hierarchy disappears at small size, the composition is not strong enough.
