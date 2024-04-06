'use strict';

module.exports = {
  BITMAPV5HEADER: {
    LogicalColorSpace: {
      // https://msdn.microsoft.com/en-us/library/cc250396.aspx
      LCS_CALIBRATED_RGB: 0x00000000,
      LCS_sRGB: 0x73524742, // eslint-disable-line camelcase
      LCS_WINDOWS_COLOR_SPACE: 0x57696e20,
    },
    Compression: {
      // https://msdn.microsoft.com/en-us/library/cc250415.aspx
      BI_RGB: 0x0000, // No compression
      BI_RLE8: 0x0001,
      BI_RLE4: 0x0002,
      BI_BITFIELDS: 0x0003,
      BI_JPEG: 0x0004,
      BI_PNG: 0x0005,
      BI_CMYK: 0x000b,
      BI_CMYKRLE8: 0x000c,
      BI_CMYKRLE4: 0x000d,
    },
    GamutMappingIntent: {
      // https://msdn.microsoft.com/en-us/library/cc250392.aspx
      LCS_GM_ABS_COLORIMETRIC: 0x00000008,
      LCS_GM_BUSINESS: 0x00000001,
      LCS_GM_GRAPHICS: 0x00000002,
      LCS_GM_IMAGES: 0x00000004,
    },
  },
};
