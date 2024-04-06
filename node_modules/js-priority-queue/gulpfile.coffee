browserify = require('browserify')
coffeeify = require('coffeeify')
del = require('del')
gulp = require('gulp')
gutil = require('gulp-util')
KarmaServer = require('karma').Server
mocha = require('gulp-mocha')
rename = require('gulp-rename')
source = require('vinyl-source-stream')
uglify = require('gulp-uglify')
derequire = require('gulp-derequire')

gulp.task 'clean', (done) ->
  del('./priority-queue*.js', done)

gulp.task 'browserify', [ 'clean' ], ->
  b = browserify('./src/PriorityQueue.coffee', {
    extensions: [ '.js', '.coffee' ]
    standalone: 'PriorityQueue'
  })
  b.transform(coffeeify)

  b.bundle()
    .on('error', (e) -> gutil.log('Browserify error', e))
    .pipe(source('priority-queue.js'))
    .pipe(derequire())
    .pipe(gulp.dest('.'))

gulp.task 'minify', [ 'browserify' ], ->
  gulp.src('priority-queue.js')
    .pipe(uglify())
    .pipe(rename(suffix: '.min'))
    .pipe(gulp.dest('.'))

gulp.task 'test-browser', (done) ->
  new KarmaServer({
    singleRun: true
    browsers: [ 'PhantomJS' ]
    frameworks: [ 'browserify', 'mocha', 'chai' ]
    reporters: [ 'dots' ]
    files: [ 'test/**/*Spec.coffee' ]
    browserify:
      debug: true
      extensions: [ '.js', '.coffee' ]
      transform: [ 'coffeeify' ]
    preprocessors:
      'test/**/*Spec.coffee': 'browserify'
  }, done).start()

gulp.task 'test-node', (done) ->
  gulp.src('test/**/*Spec.coffee', read: false)
    .pipe(mocha({
      compilers: [
        coffee: 'coffee-script/register'
      ]
      reporter: 'dot'
    }))
    .on('error', gutil.log)

gulp.task 'test', [ 'test-browser', 'test-node' ]

gulp.task('default', [ 'minify' ])
