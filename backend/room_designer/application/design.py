"""Transactional use cases exposed as ordinary typed functions to ADK."""

import asyncio
from copy import deepcopy
from datetime import datetime, timezone

from room_designer.application.critique import record_verdict
from room_designer.application.ports import AgentRuntime, ProductPicker, ProductSearch, RoomRepository
from room_designer.domain.room import Json, RoomEditor


class DesignTools:
    def __init__(self, editor: RoomEditor, search: ProductSearch, picker: ProductPicker, brief: str):
        self.editor, self.search, self.picker, self.brief = editor, search, picker, brief
        self.rejected: list[Json] = []
        # ADK may execute multiple function calls concurrently. A turn has one mutation order.
        self.lock = asyncio.Lock()

    async def _perform(self, intent: Json, operation) -> Json:
        async with self.lock:
            try:
                value = operation()
                if hasattr(value, "__await__"):
                    value = await value
                return {"status": "success", "action": value}
            except (ValueError, LookupError) as error:
                self.rejected.append({"intent": intent, "reason": str(error)})
                return {"status": "rejected", "reason": str(error)}

    async def get_room(self) -> dict:
        """Read the current room and furniture identifiers, including changes made during this turn."""
        return {k: deepcopy(self.editor.state[k]) for k in ("room", "openings", "items")}

    async def search_catalog(self, query: str, limit: int = 20) -> dict:
        """Search real catalog products by description. Returns dimensions, images, prices and identifiers."""
        if not query.strip():
            return {"status": "rejected", "reason": "La consulta está vacía"}
        return {"products": await self.search.search(query, max(1, min(20, limit)))}

    async def set_room(self, width: float, depth: float, height: float = 2.6) -> dict:
        """Create or resize a rectangular room in metres; repair or remove furniture that no longer fits."""
        room = {"shape": "rect", "w": width, "d": depth, "h": height}
        return await self._perform(
            {"kind": "setRoom", "room": room},
            lambda: self.editor.set_room(room, self.editor.state["openings"]),
        )

    async def add_opening(self, wall: str, kind: str, offset: float, width: float) -> dict:
        """Add a door or window on wall N/S/E/W. Offset and width are metres from that wall's start."""
        opening = {"wall": wall, "kind": kind, "offset": offset, "width": width}

        def apply():
            if not self.editor.state["room"]:
                raise ValueError("Crea primero la habitación")
            return self.editor.set_room(self.editor.state["room"], self.editor.state["openings"] + [opening])

        return await self._perform({"kind": "setRoom", "opening": opening}, apply)

    async def clear_openings(self) -> dict:
        """Remove all doors and windows from the current room."""

        def apply():
            if not self.editor.state["room"]:
                raise ValueError("Crea primero la habitación")
            return self.editor.set_room(self.editor.state["room"], [])

        return await self._perform({"kind": "setRoom", "openings": []}, apply)

    async def _choose(self, query: str) -> Json:
        if not query.strip():
            raise ValueError("La consulta está vacía")
        candidates = await self.search.search(query, 20)
        if not candidates:
            raise ValueError(f"Sin candidatos para «{query}»")
        chosen = await self.picker.pick(self.brief, query, candidates)
        if chosen.get("productId") not in {c["id"] for c in candidates}:
            raise ValueError("El picker eligió un producto fuera de los candidatos")
        return chosen

    async def place_furniture(
        self, search_query: str, x: float, z: float, rotation: float = 0, role: str = ""
    ) -> dict:
        """Search, visually select and place furniture. Coordinates are metres; rotation is degrees.

        Placement uses real product dimensions and repairs collisions and blocked openings.
        Read the returned action for the actual position and uid; rejected placements change nothing.
        """

        async def apply():
            chosen = await self._choose(search_query)
            return self.editor.place(chosen["productId"], x, z, rotation, search_query, chosen["reason"])

        return await self._perform(
            {
                "kind": "placeNew",
                "searchQuery": search_query,
                "role": role,
                "x": x,
                "z": z,
                "rotDeg": rotation,
            },
            apply,
        )

    async def replace_furniture(self, uid: str, search_query: str) -> dict:
        """Select a replacement product for an existing uid, retaining its position when it fits."""

        async def apply():
            old = self.editor.existing(uid)
            chosen = await self._choose(search_query)
            return self.editor.place(
                chosen["productId"], old["x"], old["z"], old["rotDeg"], search_query, chosen["reason"], uid
            )

        return await self._perform({"kind": "replace", "targetUid": uid, "searchQuery": search_query}, apply)

    async def move_furniture(self, uid: str, x: float, z: float) -> dict:
        """Move an existing furniture uid in metres. Repair must preserve its rotation."""
        return await self._perform(
            {"kind": "move", "targetUid": uid, "x": x, "z": z}, lambda: self.editor.move(uid, x, z)
        )

    async def rotate_furniture(self, uid: str, rotation: float) -> dict:
        """Rotate furniture in degrees around its vertical axis, rejecting collisions."""
        return await self._perform(
            {"kind": "rotate", "targetUid": uid, "rotDeg": rotation},
            lambda: self.editor.rotate(uid, rotation),
        )

    async def remove_furniture(self, uid: str) -> dict:
        """Remove one existing furniture uid from the room."""
        return await self._perform({"kind": "remove", "targetUid": uid}, lambda: self.editor.remove(uid))

    def functions(self) -> list:
        return [
            self.get_room,
            self.search_catalog,
            self.set_room,
            self.add_opening,
            self.clear_openings,
            self.place_furniture,
            self.replace_furniture,
            self.move_furniture,
            self.rotate_furniture,
            self.remove_furniture,
        ]


class DesignSession:
    def __init__(
        self,
        repository: RoomRepository,
        catalog: dict[str, Json],
        search: ProductSearch,
        picker: ProductPicker,
        runtime: AgentRuntime,
        timeout: float = 180,
    ):
        self.repository, self.catalog, self.search = repository, catalog, search
        self.picker, self.runtime, self.timeout = picker, runtime, timeout
        self.lock = asyncio.Lock()

    async def state(self) -> Json:
        return await self.repository.load()

    async def chat(self, brief: str, request_id: str, source: str = "user") -> Json:
        async with self.lock:
            state = await self.repository.load()
            editor = RoomEditor(state, self.catalog, request_id, datetime.now(timezone.utc).isoformat())
            tools = DesignTools(editor, self.search, self.picker, brief)
            # Nothing is persisted if the model, a dependency or a deadline fails midway.
            async with asyncio.timeout(self.timeout):
                reply = await self.runtime.run(brief, state, tools.functions())
            if tools.rejected:
                reply += f" ({len(tools.rejected)} propuestas rechazadas; consulta los motivos.)"
            editor.state["conversation"] = (
                state.get("conversation", [])
                + [{"role": source, "text": brief}, {"role": "model", "text": reply}]
            )[-20:]
            await self.repository.save(editor.state)
            return {
                "reply": reply,
                "actions": editor.actions,
                "state": editor.state,
                "rejected": tools.rejected,
            }

    async def record_verdict(self, verdict: Json, request_id: str, brief: str) -> Json:
        """Nivel 1 del bucle juez→agente: el veredicto entra en el estado
        (nota actual de la habitación, historial y conversación) y por tanto
        en el contexto de cualquier turno posterior del agente."""
        async with self.lock:
            state = await self.repository.load()
            entry = record_verdict(state, verdict, request_id,
                                   datetime.now(timezone.utc).isoformat(), brief)
            await self.repository.save(state)
            return {"entry": entry, "state": state}
