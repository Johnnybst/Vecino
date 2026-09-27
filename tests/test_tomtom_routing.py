"""ROUTING_PROVIDER=tomtom: live-traffic routes that avoid report areas as rectangles (offline)."""
import os
import unittest
from unittest.mock import patch

import httpx

from api.routing import TOMTOM_MAX_AREAS, avoid_rectangles, circle_ring, get_route

ORIGIN, DESTINATION = [-80.30, 25.76], [-80.20, 25.76]
TOMTOM_REPLY = {"routes": [{
    "summary": {"travelTimeInSeconds": 900, "lengthInMeters": 8000, "trafficDelayInSeconds": 120},
    "legs": [{"points": [{"latitude": 25.76, "longitude": -80.30}, {"latitude": 25.76, "longitude": -80.20}]}],
}]}


class TomTomRoutingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"ROUTING_PROVIDER": "tomtom", "TOMTOM_API_KEY": "test"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.requests = []

    def client(self):
        def handler(request):
            self.requests.append(request)
            return httpx.Response(200, json=TOMTOM_REPLY)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def test_plain_route_is_a_get_with_live_traffic(self):
        async with self.client() as client:
            route = await get_route(client, ORIGIN, DESTINATION, "driving-car")
        request = self.requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(request.url.params["traffic"], "true")
        self.assertEqual(request.url.params["travelMode"], "car")
        self.assertIn("25.76,-80.3:25.76,-80.2", request.url.path)
        self.assertEqual(route["geometry"]["coordinates"], [[-80.30, 25.76], [-80.20, 25.76]])
        self.assertEqual(route["properties"], {"duration_s": 900, "distance_m": 8000, "traffic_delay_s": 120})

    async def test_areas_become_rectangles_and_walking_skips_traffic(self):
        circle = [circle_ring([-80.25, 25.76], 400)]
        async with self.client() as client:
            await get_route(client, ORIGIN, DESTINATION, "foot-walking", [circle])
        request = self.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.params["travelMode"], "pedestrian")
        self.assertEqual(request.url.params["traffic"], "false")
        box = __import__("json").loads(request.content)["avoidAreas"]["rectangles"][0]
        # The box must cover the whole circle.
        self.assertLessEqual(box["southWestCorner"]["latitude"], min(p[1] for p in circle[0]))
        self.assertGreaterEqual(box["northEastCorner"]["longitude"], max(p[0] for p in circle[0]))

    def test_only_the_ten_areas_nearest_the_trip_are_sent(self):
        near = [[circle_ring([-80.25, 25.76 + i * 0.001], 100)] for i in range(TOMTOM_MAX_AREAS)]
        far = [[circle_ring([-80.25, 25.90], 100)]]
        boxes = avoid_rectangles(far + near, ORIGIN, DESTINATION)
        self.assertEqual(len(boxes), TOMTOM_MAX_AREAS)
        self.assertTrue(all(b["northEastCorner"]["latitude"] < 25.85 for b in boxes))

    async def test_default_is_still_openrouteservice(self):
        with patch.dict(os.environ, {"ROUTING_PROVIDER": ""}), \
                patch("api.routing.get_ors_route") as ors, patch("api.routing.get_tomtom_route") as tomtom:
            await get_route(None, ORIGIN, DESTINATION, "driving-car")
        ors.assert_called_once()
        tomtom.assert_not_called()
