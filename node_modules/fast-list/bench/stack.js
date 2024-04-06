var bench = require("bench")

var l = 5000
  , FastList = require("../fast-list.js")

exports.countPerLap = l * 2

exports.compare =
  { "stack []": function () {
      var list = []
      for (var i = 0; i < l; i++) {
        list.push(i)
      }
      for (var i = 0; i < l; i++) {
        list.pop()
      }
    }
  , "stack new FastList()": function () {
      var list = new FastList()
      for (var i = 0; i < l; i++) {
        list.push(i)
      }
      for (var i = 0; i < l; i++) {
        list.pop()
      }
    }
  }

bench.runMain()
