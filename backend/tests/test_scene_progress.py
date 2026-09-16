"""La vista provisional combina diferencias de editores independientes."""

from room_designer.application.progress import publish_scene, scene_progress


async def test_publish_scene_keeps_other_editors_items():
    base = {"version": 1, "items": []}
    previews = []

    async def report(state):
        previews.append(state)

    with scene_progress(base, report):
        await publish_scene(base, {**base, "items": [{"uid": "a", "x": 1}]})
        await publish_scene(base, {**base, "items": [{"uid": "b", "x": 2}]})
    assert previews[-1]["items"] == [{"uid": "a", "x": 1}, {"uid": "b", "x": 2}]
    assert base["items"] == []
    assert previews[0]["items"] == [{"uid": "a", "x": 1}]
