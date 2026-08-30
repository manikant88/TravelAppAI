# Group voting demo

## Purpose

This branch explores a deliberately narrow collaboration flow after a valid itinerary has been generated. It does not change initial planning or introduce traveller-specific routes, dates, participation, or cost allocation.

## Assumptions

- Every traveller uses the same origin and trip dates.
- Every traveller participates in the shared travel, stay, and activities.
- The existing deterministic group budget remains the source of truth.
- A room is created only from a valid canonical `TripState` and its current projection.
- Travel voting covers scheduled transport, not the derived arrival/departure transfers.

## Flow

1. The organizer creates a voting room from the generated itinerary.
2. The organizer receives one named invitation slot for every remaining traveller and opens each participant invitation in a new browser tab.
3. Participants enter the same two-panel trip workspace as the organizer. The Trip Brief is read-only and the existing itinerary cards gain a voting layer.
4. Each participant has one mutable vote per travel, stay, or activity decision.
5. The original itinerary selection is always the first candidate.
6. A participant may use **Change** to add one inventory-backed recommendation per decision, up to four total candidates.
7. Every itinerary day exposes **Add activity**. A non-conflicting activity becomes an additive recommendation; an activity that overlaps an existing activity joins that activity's competing carousel.
8. Competing candidates appear in a bounded choice carousel. Initial order is vote-descending and remains stable during the current interaction.
9. Schedule-conflicting candidates remain eligible for voting and show deterministic conflict facts plus a grounded AI explanation.
10. The highest vote count is the group choice. A tie has no winner and blocks finalization.
11. Replacement decisions with no votes retain the original itinerary selection; additive recommendations with no votes remain excluded.
12. The organizer may finalize without full turnout.
13. All winners are validated together, committed atomically, and locked.
14. A finalized room is read-only and cannot be reopened in the demo.

## AI collaboration

- Every participant gets a personal chat in the existing workspace shell; chat history is not shared with the group.
- AI may explain the canonical itinerary, summarize current vote facts, and search grounded alternatives.
- A chat-found alternative is never shared automatically. The participant must confirm **Recommend to group**.
- Recommended candidates receive an explanation grounded in inventory facts, group cost delta, and deterministic schedule conflicts.
- AI never counts votes, casts a vote, changes the canonical itinerary, or finalizes the room.

## Trust boundaries

- Participant and organizer tokens are random capabilities; the organizer token is never included in the public room payload.
- Inventory IDs submitted as recommendations are resolved and checked against the target route, stop, category, and date on the server.
- Candidate conflicts are allowed during exploration; the complete winning set must pass canonical proposal validation before finalization.
- Vote counts and winners are deterministic code, not model output.
- Finalization uses the existing proposal service, inventory resolution, budget/schedule validation, version check, and lock operations.
- Polling is used instead of realtime sockets.

## Persistence limitation

The canonical demo room uses versioned browser `localStorage`. Each tab keeps only its viewer identity in `sessionStorage`, and open tabs synchronize through `BroadcastChannel` plus the browser storage event. This makes voting feel immediate and survives a development-server restart, but works only in the same browser profile and origin. Opening an invite on another device cannot access the room.

The organizer's Home action removes the local room for a clean new demo. A production continuation should replace this browser store with authenticated writable persistence and hashed capability tokens. The read-only inventory connection must remain separate.

## Explicitly deferred

- authentication and invitations;
- personal origins, dates, participation, and budgets;
- partial activity attendance and room allocation;
- custom expense splits and settlement;
- comments, presence, notifications, and WebSockets;
- organizer tie-breaking UI;
- reopening a finalized room;
- AI-generated voting or autonomous finalization.
