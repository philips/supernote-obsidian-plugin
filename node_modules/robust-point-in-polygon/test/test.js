"use strict"

var inside = require("../robust-pnp.js")

require("tape")(function(t) {

  var polygon = [ [ 1, 1 ], [ 1, 2 ], [ 2, 2 ], [ 2, 1 ] ]
  t.equals(inside(polygon, [ 1.5, 1.5 ]), -1)
  t.equals(inside(polygon, [ 1.2, 1.9 ]), -1)
  t.equals(inside(polygon, [ 0, 1.9 ]), 1)
  t.equals(inside(polygon, [ 1.5, 2 ]), 0)
  t.equals(inside(polygon, [ 1.5, 2.2 ]), 1)
  t.equals(inside(polygon, [ 3, 5 ]), 1)
  t.equals(inside(polygon, [1.5, 2]), 0)

  var polygon = [ [-1,-1], [1,-1], [1,1], [-1,1] ]
  for(var j=0; j<3; ++j) {
    t.equals(inside(polygon, [0,0]), -1)
    var subdiv = []
    for(var i=0; i<polygon.length; ++i) {
      var a = polygon[i]
      var b = polygon[(i+1)%polygon.length]
      var c = [0.5*(a[0] + b[0]), 0.5*(a[1] + b[1])]
      subdiv.push(a, c)
      t.equals(inside(polygon, polygon[i]), 0)
      t.equals(inside(polygon, c), 0)
    }
    t.equals(inside(polygon, [1e10, 1e10]), 1)
    polygon = subdiv
  }

  t.end()
})