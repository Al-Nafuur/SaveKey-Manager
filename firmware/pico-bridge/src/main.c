#include <stdio.h>

#include "pico/stdlib.h"

#include "i2c_bus.h"

// Bring-up scan range: E1 (0x50) plus headroom for the second EEPROM's
// possible 64 KiB address blocks (0x51-0x54) and a bit beyond, in case a
// larger chip than expected is fitted.
#define PROBE_ADDR_START 0x50
#define PROBE_ADDR_END 0x57

int main(void) {
    stdio_init_all();
    i2c_bus_init();

    // Give the USB CDC connection a moment to enumerate before the first
    // prints, so early output isn't lost while a terminal reconnects.
    sleep_ms(1500);

    while (true) {
        printf("\n--- SaveKey Plus bridge: bus scan ---\n");
        for (uint8_t addr = PROBE_ADDR_START; addr <= PROBE_ADDR_END; addr++) {
            bool present = i2c_bus_probe(addr);
            printf("  0x%02X: %s\n", addr, present ? "ACK (device present)" : "no response");
        }
        sleep_ms(3000);
    }

    return 0;
}
