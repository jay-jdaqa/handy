# Handy

Webcam hand and finger tracking in 3D, in the browser. Step one of a hand-driven light-and-sound effect.

Open the page, click **Start camera**, allow the camera. Video is processed locally and never leaves your computer.

## What it does

- Tracks up to eight hands, 21 joints each (wrist plus four joints per finger), using Google's MediaPipe Hand Landmarker.
- Draws a green skeleton with red joints over a mirrored video.
- **Puppets** switch: a felt sock puppet on every hand, each in its own colour. The fingers are the top jaw and the thumb the bottom jaw, so the mouth opens as you open your hand. Googly eyes look the way your fingers point.
- Shows a small 3D view you can drag to rotate.
- Fire pours from your index fingertips (switch at the top lights all ten), flaring when you move fast.
- Glinda Mode swaps the fire for pink blossoms that bud, bloom and drift down with sparkles.
- Picks between cameras when more than one is connected.

## Data for later steps

Every frame is available from `window.handy`:

```js
handy.latest            // most recent frame
handy.on(frame => {})   // called on every frame, returns an unsubscribe function
```

A frame looks like:

```js
{
  cameraId, timestamp, width, height,
  hands: [{
    id,                       // 0..7, stays with the same hand while it is in view
    side: "Left" | "Right",   // the person's actual hand
    score,                    // confidence 0..1
    points: [{x, y, z}],      // 21 joints; x,y in 0..1 screen space (mirrored), z = depth relative to wrist
    world:  [{x, y, z}],      // 21 joints in metres around the hand's centre
    joints: { wrist, thumbTip, indexTip, middleTip, ringTip, pinkyTip, ... },
    pinch,                    // cm between thumb tip and index tip
  }]
}
```

## Depth

With one camera, `z` is depth relative to the wrist, not true distance from the camera. `js/tracker.js` runs one `HandTracker` per camera, so a second camera can be added later and both views triangulated for true depth.

## Run locally

Any static server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000. Camera access needs `localhost` or HTTPS.
