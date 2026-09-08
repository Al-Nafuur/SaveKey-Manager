#ifndef I2C_BUS_H
#define I2C_BUS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// SaveKey Plus prototype wiring: physical header pins 6/7 on the Pico
// board, which are GPIO4/GPIO5 — NOT GPIO6/GPIO7 (physical pin number and
// GPIO number are different things; the Pico's silkscreen pin 6 is GPIO4,
// pin 7 is GPIO5, pin 9 is GPIO6, pin 10 is GPIO7). These constants are GPIO
// numbers, as gpio_set_function() and friends expect. GPIO4/GPIO5 are
// hardwired on the RP2040 silicon to I2C0 (confirmed the hard way: i2c1 on
// GPIO6/GPIO7 — the actually-unconnected pins — gave clean but meaningless
// fast NACKs on every address, since nothing is wired there at all).
#define I2C_BUS_INSTANCE i2c0
#define I2C_BUS_SDA_PIN 4
#define I2C_BUS_SCL_PIN 5
#define I2C_BUS_BAUD_HZ 100000

// Largest single write/read payload (excluding the 2-byte memory address
// header) this driver will accept in one call. Callers are responsible for
// not crossing the target EEPROM's physical page boundary within a write.
#define I2C_BUS_MAX_PAYLOAD 256

void i2c_bus_init(void);

// 1-byte, timeout-bounded write (side-effect-free); returns true if the
// device at addr acknowledges its address. Deliberately not len=0
// (i2c_write_blocking never puts anything on the bus for len=0, so it can't
// detect a NACK) and deliberately timeout-bounded, not plain
// i2c_write_blocking (confirmed on real hardware: addressing a genuinely
// absent device can leave the RP2040's I2C block spinning forever with no
// timeout at all, freezing the whole firmware on the first empty address).
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
