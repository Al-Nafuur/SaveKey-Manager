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
    uint8_t dummy = 0;
    // A 0-length write still addresses the device and waits for an ACK/NACK,
    // which is the standard way to probe an I2C bus without side effects.
    int result = i2c_write_blocking(I2C_BUS_INSTANCE, addr, &dummy, 0, false);
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
