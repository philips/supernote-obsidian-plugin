# The Problem

You've got some thing where you need to push a bunch of stuff into a
queue and then shift it out.  Or, maybe, you need to pop it out
stack-like, but it's not clear at the outset which way it's going to go.

Arrays work for this, but are a bit costly performance-wise in the mixed
case.  In the pure-stack case (or, as of recent V8 versions, the pure-queue
case as well), Arrays are best.

In cases where it's mixed, a linked list implementation can be
significantly faster.  See the benchmark scripts in `bench/*.js` to
measure the differences.

This lacks a lot of features that arrays have:

1. You can't specify the size at the outset.
2. It's not indexable.
3. There's no join, concat, etc.

If any of this matters for your use case, you're probably better off
using an Array object.

If you *know* that you'll be using it as a stack or a queue exclusively,
then you're better off using an Array object.

If you know the eventual size at the offset, then you're definitely
better off using an Array.

## Installing

```
npm install fast-list
```

## API

```javascript
var FastList = require("fast-list")
var list = new FastList()
list.push("foo")
list.unshift("bar")
list.push("baz")
console.log(list.length) // 2
console.log(list.pop()) // baz
console.log(list.shift()) // bar
console.log(list.shift()) // foo
```

### Methods

* `push`: Just like Array.push, but only can take a single entry
* `pop`: Just like Array.pop.  Note: if you're only using push and pop,
  then you have a stack, and Arrays are better for that.
* `shift`: Just like Array.shift.  Note: if you're only using push and
  shift, then you have a queue, and Arrays are better for that.
* `unshift`: Just like Array.unshift, but only can take a single entry.
* `drop`: Drop all entries
* `item(n)`: Retrieve the nth item in the list.  This involves a walk
  every time.  It's very slow.  If you find yourself using this,
  consider using a normal Array instead.
* `map(fn, thisp)`: Like `Array.prototype.map`.  Returns a new FastList.
* `reduce(fn, startValue, thisp)`: Like `Array.prototype.reduce`
* `forEach(fn, this)`: Like `Array.prototype.forEach`
* `filter(fn, thisp)`: Like `Array.prototype.filter`. Returns a new
  FastList.
* `slice(start, end)`: Retrieve an array of the items at this position.
  This involves a walk every time.  It's very slow.  If you find
  yourself using this, consider using a normal Array instead.

### Members

* `length`: The number of things in the list.  Note that, unlike
  Array.length, this is not a getter/setter, but rather a counter that
  is internally managed.  Setting it can only cause harm.
