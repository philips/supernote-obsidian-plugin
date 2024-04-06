var bench = require("bench")

var l = 5000
  , FastList = require("../fast-list.js")

exports.countPerLap = l * 2

var mixed =
{ "mixed []": function () {
    var list = []
    for (var j = 0; j < l; j ++) {
      if (j % 2) list.push(j)
      else list.unshift(j)
    }
    for (var j = 0; j < l; j ++) {
      if (j % 2) list.shift()
      else list.pop()
    }
  }
, "mixed FastList()": function () {
    var list = new FastList()
    for (var j = 0; j < l; j ++) {
      if (j % 2) list.push(j)
      else list.unshift(j)
    }
    for (var j = 0; j < l; j ++) {
      if (j % 2) list.shift()
      else list.pop()
    }
  }
}

var queue =
{ "queue []": function () {
    var list = []
    for (var i = 0; i < l; i++) {
      list.push(i)
    }
    for (var i = 0; i < l; i++) {
      list.shift()
    }
  }
, "queue FastList()": function () {
    var list = new FastList()
    for (var i = 0; i < l; i++) {
      list.push(i)
    }
    for (var i = 0; i < l; i++) {
      list.shift()
    }
  }
}

var stack =
{ "stack []": function () {
    var list = []
    for (var i = 0; i < l; i++) {
      list.push(i)
    }
    for (var i = 0; i < l; i++) {
      list.pop()
    }
  }
, "stack FastList()": function () {
    var list = new FastList()
    for (var i = 0; i < l; i++) {
      list.push(i)
    }
    for (var i = 0; i < l; i++) {
      list.pop()
    }
  }
}

exports.compare = {}
;[stack, queue, mixed].forEach(function (c) {
  Object.keys(c).forEach(function (k) {
    exports.compare[k] = c[k]
  })
})

bench.runMain()
