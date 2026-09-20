---
name: image-first-frontend
description: Use when building or improving a frontend from generated UI comps, screenshots, moodboards, or visual references. Triggers on image-first UI, design comp to code, Taste Skill, anti-slop frontend, visual redesign, landing page polish, responsive visual matching, or screenshot-driven UI fixes.
---

# Image-First Frontend

Use this workflow to avoid generic AI-looking interfaces. The goal is to establish visual taste with images first, then implement the design faithfully in code.

## When To Use

- The user wants a website, landing page, product page, or visual UI with high design quality.
- The user provides screenshots, generated UI comps, moodboards, or visual references.
- The task asks to improve a bland frontend.
- The task mentions Taste Skill, image-to-code, visual comp, anti-slop UI, or design taste.

Do not use this workflow for small text-only edits, backend-only work, or non-visual scripts.

## Workflow

1. Clarify the product, audience, mood, must-have sections, and visual constraints.
2. Generate or collect reference images before coding when the visual direction is unclear.
3. Produce multiple section-level comps rather than one giant page comp when possible.
4. Save all generated/reference images into the project so implementation does not depend on chat-only attachments.
5. Analyze each comp before coding:
   - what must be real DOM text and controls
   - what can be bitmap background or decorative media
   - what needs separate clean assets
   - responsive breakpoints and crop behavior
6. Create clean assets when needed by removing baked-in UI text, logos, buttons, or overlays from background images.
7. Implement the UI in the project's existing stack. Use real text, semantic controls, responsive layout, and accessible contrast.
8. Add motion only when it improves the product feel. Prefer subtle scroll reveal, hover, or section transitions; respect `prefers-reduced-motion`.
9. Verify visually in browser against the reference image. Use screenshots for meaningful frontend changes.
10. Iterate by pointing to exact mismatches: spacing, hierarchy, typography, color, crop, alignment, overflow, responsive breakage.

## Design Taste Checks

- Avoid centered generic hero blocks unless the reference clearly calls for them.
- Avoid one-note palettes and decorative gradients/orbs without purpose.
- Make typography hierarchy intentional: headline, support copy, labels, metadata, controls.
- Use spacing and alignment as design material, not afterthoughts.
- Keep images inspectable and relevant. Do not bury important product/place/person/object visuals under dark overlays.
- Preserve text as HTML where users need to read, select, translate, or access it.
- Use bitmap assets for atmosphere, photography, texture, generated scenes, and complex illustrations.

## Asset Rules

- Put assets in the project's existing public/static asset location.
- Use descriptive filenames such as `hero-background.webp`, `brand-philosophy-card-01.webp`.
- Record the source of generated/reference images when relevant.
- Do not commit huge raw working files unless the project already stores them.
- If deployment needs external hosting, confirm the destination and data before uploading.

## Verification

- Run the project's normal verification command.
- For frontend changes, open the local page and inspect desktop and mobile widths.
- Check that text does not overlap, controls remain clickable, images crop intentionally, and motion does not obscure content.
- If the project has no browser setup, state the limitation and provide the closest available verification.
