robust-point-in-polygon
=======================
Exactly determines if a point is contained in a 2D polygon.

# Example

```javascript
var classifyPoint = require("robust-point-in-polygon")
var polygon = [ [ 1, 1 ], [ 1, 2 ], [ 2, 2 ], [ 2, 1 ] ]

console.log(
  classifyPoint(polygon, [1.5, 1.5]),
  classifyPoint(polygon, [1, 2]),
  classifyPoint(polygom, [100000, 10000]))
```

Output:

```
-1 0 1
```

# Install

```
npm install robust-point-in-polygon
```

# API

### `require("robust-point-in-polygon")(loop, point)`
Tests if a point is contained in the interior of a simple polygon

* `loop` is an array of vertices for the polygon
* `point` is a 2D point which is classified against the polygon

**Returns** An integer which determines the position of `point` relative to `polygon`.  This has the following interpretation:

* `-1` if `point` is contained inside `loop`
* `0` if `point` is on the boundary of `loop`
* `1` if `point` is outside `loop`

# Credits
(c) 2014 Mikola Lysenko. MIT License