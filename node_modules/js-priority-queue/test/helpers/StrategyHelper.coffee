require('../test_helper')

numberComparator = (a, b) ->
  throw 'Invalid compare' if !a? || !b?
  a - b

queueToArray = (queue, nElements) -> queue.dequeue() for i in [ 0 ... nElements ]

module.exports = StrategyHelper =
  describeStrategy: (description, strategy) ->
    describe description, ->
      priv = undefined

      describe 'with initial values', ->
        beforeEach ->
          priv = new strategy(
            comparator: numberComparator
            initialValues: [ 5, 2, 3, 4, 1, 6, 7 ]
          )

        it 'should dequeue the initial values in order', ->
          expect(queueToArray(priv, 7)).to.deep.equal([1, 2, 3, 4, 5, 6, 7])

      describe 'starting with some elements', ->
        beforeEach ->
          priv = new strategy(comparator: numberComparator)
          priv.queue(3)
          priv.queue(1)
          priv.queue(7)
          priv.queue(2)
          priv.queue(6)
          priv.queue(5)

        describe 'peek', ->
          it 'should see the first element', ->
            expect(priv.peek()).to.equal(1)

          it 'should not remove the first element', ->
            priv.peek()
            expect(priv.peek()).to.equal(1)

        describe 'dequeue', ->
          it 'should dequeue elements in order', ->
            expect(priv.dequeue()).to.equal(1)
            expect(priv.dequeue()).to.equal(2)
            expect(priv.dequeue()).to.equal(3)

        describe 'queue', ->
          it 'should queue at the beginning', ->
            priv.queue(0.5)
            expect(queueToArray(priv, 4)).to.deep.equal([0.5, 1, 2, 3])

          it 'should queue at the middle', ->
            priv.queue(1.5)
            expect(queueToArray(priv, 4)).to.deep.equal([1, 1.5, 2, 3])

          it 'should queue at the end', ->
            priv.queue(3.5)
            expect(queueToArray(priv, 4)).to.deep.equal([1, 2, 3, 3.5])

          it 'should queue a duplicate at the beginning', ->
            priv.queue(1)
            expect(queueToArray(priv, 4)).to.deep.equal([1, 1, 2, 3])

          it 'should queue a duplicate in the middle', ->
            priv.queue(2)
            expect(queueToArray(priv, 4)).to.deep.equal([1, 2, 2, 3])

          it 'should queue a duplicate at the end', ->
            priv.queue(3)
            expect(queueToArray(priv, 4)).to.deep.equal([1, 2, 3, 3])

        describe 'clear', ->
          it 'should remove all elements', ->
            expect(priv.peek()).to.equal(1)
            priv.clear()
            priv.queue(10)
            expect(priv.peek()).to.equal(10)
