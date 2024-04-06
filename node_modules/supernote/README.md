# Supernote file-format support

This library is heavily inspired by the [Python implementation by jya-dev](https://github.com/jya-dev/supernote-tool). This one currently only supports the X series notebooks.

Ratta Supernote has often commented that the file-format is yet unstable and shouldn't be much relied upon (yet). Please keep this in mind.

For some quick snippets, take a look at the [smoke tests](./tests/main.test.ts).

Instead of the typical Python image processing libraries, this library currently sticks to reading the files plainly (using [fs-extra](https://github.com/jprichardson/node-fs-extra)) and exports them as [Sharp](https://github.com/lovell/sharp) image objects while using [color](https://github.com/Qix-/color) for color management.

To export your Sharp image objects, take a look at their documentation.
