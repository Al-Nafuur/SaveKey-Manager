#include "pico/stdlib.h"
#include "pico/stdio_usb.h"

#include "command.h"
#include "i2c_bus.h"

int main(void) {
    stdio_init_all();
    // The pico-sdk's CRLF "convenience" translation is on by default and
    // applies to EVERY stdout write indiscriminately — including our raw
    // binary READ responses in command.c. A literal 0x0A byte anywhere in
    // that binary data (e.g. a sector number whose low byte is 0x0A) would
    // silently become 0x0D 0x0A, corrupting the stream length the host
    // expects. Confirmed on real hardware: a raw byte round-trip test
    // showed exactly this corruption. Our protocol only ever emits bare
    // \n itself, so disabling this is safe and necessary.
    stdio_set_translate_crlf(&stdio_usb, false);
    i2c_bus_init();

    // Give the USB CDC connection a moment to enumerate before the first
    // prints, so early output isn't lost while a terminal/app reconnects.
    sleep_ms(1500);

    command_run_loop();

    return 0;
}
