const zlib = require("node:zlib");
if (typeof zlib.createZstdDecompress === "undefined") {
  zlib.createZstdDecompress = () => {};
}
