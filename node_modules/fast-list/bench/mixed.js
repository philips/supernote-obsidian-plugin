var bench = require("bench")

var l = 5000
  , FastList = require("../fast-list.js")

exports.countPerLap = l * 2

exports.compare =
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
  , "mixed new FastList()": function () {
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

bench.runMain()
