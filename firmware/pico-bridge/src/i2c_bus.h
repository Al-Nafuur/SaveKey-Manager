#ifndef I2C_BUS_H
#define I2C_BUS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// SaveKey Plus prototype wiring: I2C0 on the Pico's default pins.
#define I2C_BUS_INSTANCE i2c0
#define I2C_BUS_SDA_PIN 6
#define I2C_BUS_SCL_PIN 7
#define I2C_BUS_BAUD_HZ 100000

// Largest single write/read payload (excluding the 2-byte memory address
// header) this driver will accept in one call. Callers are responsible for
// not crossing the target EEPROM's physical page boundary within a write.
#define I2C_BUS_MAX_PAYLOAD 256

void i2c_bus_init(void);

// Zero-length write; returns true if the device at addr acknowledges.
bool i2c_bus_probe(uint8_t addr);

// Writes a 2-byte big-endian memory address followed by `len` data bytes, as
// one address+data transaction (required so the EEPROM doesn't mistake a
// second write call for a fresh address pointer).
// Returns the number of data bytes written, or a negative PICO_ERROR_* code.
int i2c_bus_write(uint8_t addr, uint16_t mem_addr, const uint8_t *data, size_t len);

// Writes a 2-byte big-endian memory address (repeated start, no stop), then
// reads `len` bytes into `data` — the standard "set pointer, then current
// address read" EEPROM idiom.
// Returns the number of bytes read, or a negative PICO_ERROR_* code.
int i2c_bus_read(uint8_t addr, uint16_t mem_addr, uint8_t *data, size_t len);

#endif
