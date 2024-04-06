(function () {
    const swap = (arr, x, y) => [arr[x], arr[y]] = [arr[y], arr[x]];
    const calcMiddle = (x, y) => ~~((x + y) / 2);


    function quickSelect(arr) {
        let low = 0;
        let high = arr.length - 1;
        let middle, ll, hh;
        let median = calcMiddle(low, high);

        while (true) {
            if (high <= low) {// One element only
                return arr[median];
            }

            if (high == low + 1) { // Two elements only
                if (arr[low] > arr[high])
                    swap(arr, low, high);
                return arr[median];
            }

            // Find median of low, middle and high items; swap into position low
            middle = calcMiddle(low, high);
            if (arr[middle] > arr[high]) swap(arr, middle, high);
            if (arr[low] > arr[high]) swap(arr, low, high);
            if (arr[middle] > arr[low]) swap(arr, middle, low);

            // Swap low item (now in position middle) into position (low+1)
            swap(arr, middle, low + 1);

            // Nibble from each end towards middle, swapping items when stuck
            ll = low + 1;
            hh = high;
            while (true) {
                do ll++; while (arr[low] > arr[ll]);
                do hh--; while (arr[hh] > arr[low]);

                if (hh < ll)
                    break;

                swap(arr, ll, hh);
            }

            // Swap middle item (in position low) back into correct position
            swap(arr, low, hh);

            // Re-set active partition
            if (hh <= median)
                low = ll;
            if (hh >= median)
                high = hh - 1;
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = quickSelect
    } else {
        window.median = quickSelect
    }
})();
