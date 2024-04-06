AbstractPriorityQueue = require('./PriorityQueue/AbstractPriorityQueue')
ArrayStrategy = require('./PriorityQueue/ArrayStrategy')
BinaryHeapStrategy = require('./PriorityQueue/BinaryHeapStrategy')
BHeapStrategy = require('./PriorityQueue/BHeapStrategy')

class PriorityQueue extends AbstractPriorityQueue
  constructor: (options) ->
    options ||= {}
    options.strategy ||= BinaryHeapStrategy
    options.comparator ||= (a, b) -> (a || 0) - (b || 0)
    super(options)

PriorityQueue.ArrayStrategy = ArrayStrategy
PriorityQueue.BinaryHeapStrategy = BinaryHeapStrategy
PriorityQueue.BHeapStrategy = BHeapStrategy

module.exports = PriorityQueue
