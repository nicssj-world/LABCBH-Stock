---
name: LABCBH Stock
description: Laboratory Control Bench for contract, procurement, and scientific inventory operations
---

<!-- SEED: established with the user before implementation; re-run $impeccable document once there's code to capture the actual tokens and components. -->

# Design System: LABCBH Stock

## Overview

**Creative North Star: "Laboratory Control Bench"**

The interface behaves like a calm laboratory control surface: operational, exact, and built for repeated use throughout a workday. Queues, quantities, deadlines, and next actions lead; decoration recedes. The system should feel closer to an analyzer worklist and accession bench than a generic corporate dashboard.

Dense information is organized through alignment, cool tonal layers, compact status bands, and clearly separated working regions. Motion is limited to state changes, confirmations, and the movement of work through a queue.

**Key Characteristics:**

- Task queues and exceptions appear before retrospective charts.
- Numeric columns use tabular figures and strict alignment.
- Color reinforces a written status; it never carries meaning alone.
- Desktop favors dense scanability; mobile reveals one decision or task group at a time.
- Every mutation produces immediate feedback and an auditable result.

## Colors

Use a restrained cool laboratory palette: deep blue-green navigation, pale instrument-panel surfaces, white work areas, and limited semantic accents.

- Deep laboratory navy anchors navigation and high-authority controls.
- Muted teal indicates active paths and selected operational context.
- Cool blue-gray separates dense regions without excessive borders.
- Amber is reserved for work requiring attention soon.
- Red is reserved for overdue, depleted, invalid, or destructive states.
- Green confirms completed or sufficient states.

**The Semantic Accent Rule.** Accent colors appear only when they communicate state, urgency, selection, or the next action.

## Typography

Thai content uses a highly legible workhorse sans-serif with distinct numerals; implementation should begin with Noto Sans Thai and use a compact monospaced companion only for identifiers, Lot numbers, PO numbers, LS codes, and tabular figures.

Hierarchy is compact rather than dramatic. Page titles orient quickly, section titles label a working region, and row text remains readable at high density. Uppercase English micro-labels may annotate operational context but never replace Thai labels.

**The Identifier Rule.** Codes and numbers align consistently and never compete typographically with names and actions.

## Layout

Desktop uses a persistent compact sidebar, a narrow contextual header, and a working canvas divided into queue, exception, and analysis regions. The grid follows an 8px rhythm with tighter 4px relationships inside table rows and control groups.

The primary viewport answers three questions in order: what needs attention, what is due next, and what has changed. Mobile removes the persistent sidebar, converts wide tables into task-first cards or controlled horizontal views, and keeps the primary action reachable without hiding content behind fixed controls.

## Elevation & Depth

The system is flat by default. Tonal surfaces, borders, and inset bands communicate grouping. Shadows appear only for floating dialogs, sticky action bars, menus, or a hovered interactive surface.

**The Flat Bench Rule.** A resting work surface uses no decorative shadow; elevation must correspond to interaction or stacking.

## Shapes

Forms use gently compact corners rather than pills. Working panels and tables have small-to-medium radii, while status chips may use tighter capsules. Borders remain crisp and subtle, echoing instrument panels and printed laboratory labels.

## Do's and Don'ts

### Do:

- **Do** place next actions and exceptional states before aggregate reporting.
- **Do** pair every color state with a label, icon, or numeric threshold.
- **Do** preserve visible labels, keyboard focus, and 44px minimum interactive targets.
- **Do** use Thai fiscal-year terminology and locale-aware dates and amounts.
- **Do** keep destructive and irreversible actions spatially separate.

### Don't:

- **Don't** use ornamental gradients, glass effects, or decorative dashboards.
- **Don't** use emoji as structural icons or progress indicators.
- **Don't** hide operational facts behind hover-only tooltips.
- **Don't** compress mobile forms into unreadable desktop tables.
- **Don't** let retrospective charts outrank today's queue and alerts.
