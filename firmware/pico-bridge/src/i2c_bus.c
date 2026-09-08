#include "i2c_bus.h"

#include <string.h>

#include "hardware/i2c.h"
#include "pico/stdlib.h"

void i2c_bus_init(void) {
    i2c_init(I2C_BUS_INSTANCE, I2C_BUS_BAUD_HZ);
    gpio_set_function(I2C_BUS_SDA_PIN, GPIO_FUNC_I2C);
    gpio_set_function(I2C_BUS_SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(I2C_BUS_SDA_PIN);
    gpio_pull_up(I2C_BUS_SCL_PIN);
}

bool i2c_bus_probe(uint8_t addr) {
    // Deliberately a 1-byte WRITE, not len=0: a 0-length write never puts
    // anything on the bus at all (the SDK's byte loop is simply skipped),
    // so it always "succeeds" regardless of whether a device is there.
    //
    // Deliberately timeout-bounded, not plain i2c_write_blocking: on real
    // hardware, addressing a genuinely absent device (open bus, e.g.
    // 0x51-0x53 here) can leave the RP2040's I2C block spinning forever in
    // its internal wait-for-TX_EMPTY loop — that plain blocking call has no
    // timeout at all, so one empty address freezes the whole firmware
    // (confirmed: disabling this probe call restored serial output). A
    // bounded timeout lets a stuck transaction be treated as "no device"
    // instead of hanging.
    //
    // The single dummy byte only ever loads the EEPROM's address-pointer
    // high byte and is followed by a STOP before any data byte would be
    // written, so it has no side effects on stored contents.
    uint8_t dummy = 0;
    int result = i2c_write_timeout_us(I2C_BUS_INSTANCE, addr, &dummy, 1, false, 10000);
    return result >= 0;
}

int i2c_bus_write(uint8_t addr, uint16_t mem_addr, const uint8_t *data, size_t len) {
    if (len > I2C_BUS_MAX_PAYLOAD) {
        return PICO_ERROR_INVALID_ARG;
    }

    // Address header and payload must go out as a single transaction — two
    // separate write calls would each assert their own START/RESTART, and a
    // restart into write mode makes the EEPROM expect a fresh 2-byte address
    // again instead of continuing the data stream.
    uint8_t buffer[2 + I2C_BUS_MAX_PAYLOAD];
    buffer[0] = (uint8_t)(mem_addr >> 8);
    buffer[1] = (uint8_t)(mem_addr & 0xFF);
    memcpy(buffer + 2, data, len);

    int result = i2c_write_blocking(I2C_BUS_INSTANCE, addr, buffer, len + 2, false);
    if (result < 0) {
        return result;
    }
    return (int)len;
}

int i2c_bus_read(uint8_t addr, uint16_t mem_addr, uint8_t *data, size_t len) {
    uint8_t header[2] = { (uint8_t)(mem_addr >> 8), (uint8_t)(mem_addr & 0xFF) };

    // Write the address pointer without a STOP, then read with a repeated
    // START — this is the standard EEPROM "current address read" pattern.
    if (i2c_write_blocking(I2C_BUS_INSTANCE, addr, header, sizeof(header), true) < 0) {
        return PICO_ERROR_GENERIC;
    }
    return i2c_read_blocking(I2C_BUS_INSTANCE, addr, data, len, false);
}
