#include "command.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "pico/time.h"

#include "i2c_bus.h"

#define LINE_BUF_SIZE 64
// After a write, the EEPROM needs a short internal cycle time before it
// ACKs its address again (datasheet-typical ~5ms; confirmed on real
// hardware that an immediate follow-up read/write can otherwise NACK and
// come back as all-zero/garbage). Poll instead of a fixed delay so we don't
// wait longer than necessary, capped well above the typical cycle time.
#define WRITE_CYCLE_POLL_TIMEOUT_MS 20
#define SCAN_ADDR_START 0x50
#define SCAN_ADDR_END 0x57
#define READ_STREAM_CHUNK 128
#define READ_MAX_LEN 65535
#define I2C_ADDR_MAX 0x7F
#define MEM_ADDR_MAX 0xFFFF

// Blocks until a full line (up to max_len-1 chars) or newline arrives.
// Tolerates a preceding '\r' so CRLF-sending terminals work too.
static size_t read_line(char *buf, size_t max_len) {
    size_t i = 0;
    while (i < max_len - 1) {
        int c = getchar();
        if (c == '\n') break;
        if (c == '\r') continue;
        buf[i++] = (char)c;
    }
    buf[i] = '\0';
    return i;
}

static void handle_scan(void) {
    for (uint8_t addr = SCAN_ADDR_START; addr <= SCAN_ADDR_END; addr++) {
        if (i2c_bus_probe(addr)) {
            printf("ACK %02X\n", addr);
        }
    }
    printf("OK\n");
}

// "READ <addr_hex> <memaddr_hex> <len_dec>" -> "OK <len>\n" + len raw bytes.
static void handle_read(const char *args) {
    char *end;
    unsigned long addr = strtoul(args, &end, 16);
    unsigned long mem_addr = strtoul(end, &end, 16);
    unsigned long len = strtoul(end, &end, 10);

    if (addr == 0 || addr > I2C_ADDR_MAX || mem_addr > MEM_ADDR_MAX ||
        len == 0 || len > READ_MAX_LEN || mem_addr + len > (unsigned long)MEM_ADDR_MAX + 1) {
        printf("ERR bad request\n");
        return;
    }

    printf("OK %lu\n", len);

    uint8_t buf[READ_STREAM_CHUNK];
    uint16_t offset = (uint16_t)mem_addr;
    unsigned long remaining = len;
    while (remaining > 0) {
        size_t chunk = remaining < READ_STREAM_CHUNK ? (size_t)remaining : READ_STREAM_CHUNK;
        int result = i2c_bus_read((uint8_t)addr, offset, buf, chunk);
        if (result < 0) {
            // Already committed to `len` bytes via the OK header above, so a
            // failure here can't turn into an ERR without desyncing the
            // stream — pad with zeros instead. Rare in practice once the
            // address has ACKed (checked implicitly by the read itself).
            memset(buf, 0, chunk);
        }
        fwrite(buf, 1, chunk, stdout);
        offset = (uint16_t)(offset + chunk);
        remaining -= chunk;
    }
    fflush(stdout);
}

// Blocks until `addr` ACKs again (write cycle complete) or the timeout
// elapses, whichever first — so a follow-up command from the host is never
// racing the EEPROM's internal write cycle.
static void wait_for_write_cycle(uint8_t addr) {
    absolute_time_t deadline = make_timeout_time_ms(WRITE_CYCLE_POLL_TIMEOUT_MS);
    while (!time_reached(deadline)) {
        if (i2c_bus_probe(addr)) return;
    }
}

// "WRITE <addr_hex> <memaddr_hex> <len_dec>" then len raw bytes from the
// host -> "OK\n" or "ERR ...\n". Length is capped to I2C_BUS_MAX_PAYLOAD
// (one physical EEPROM page's worth) — multi-page writes are the caller's
// job, done as several WRITE commands, one per page.
static void handle_write(const char *args) {
    char *end;
    unsigned long addr = strtoul(args, &end, 16);
    unsigned long mem_addr = strtoul(end, &end, 16);
    unsigned long len = strtoul(end, &end, 10);

    // Deliberately does NOT drain `len` bytes from stdin before erroring on
    // a bad length: this protocol assumes a single well-behaved client (this
    // repo's own PWA), which will only ever send lengths within
    // I2C_BUS_MAX_PAYLOAD in the first place. A misbehaving client sending
    // an oversized WRITE would desync the command stream after this point —
    // acceptable since there's no other client today.
    if (addr == 0 || addr > I2C_ADDR_MAX || mem_addr > MEM_ADDR_MAX ||
        len == 0 || len > I2C_BUS_MAX_PAYLOAD || mem_addr + len > (unsigned long)MEM_ADDR_MAX + 1) {
        printf("ERR bad length (max %d)\n", I2C_BUS_MAX_PAYLOAD);
        return;
    }

    uint8_t payload[I2C_BUS_MAX_PAYLOAD];
    for (unsigned long i = 0; i < len; i++) {
        payload[i] = (uint8_t)getchar();
    }

    int result = i2c_bus_write((uint8_t)addr, (uint16_t)mem_addr, payload, (size_t)len);
    if (result < 0) {
        printf("ERR i2c write failed\n");
        return;
    }
    wait_for_write_cycle((uint8_t)addr);
    printf("OK\n");
}

static void handle_command(const char *line) {
    if (strcmp(line, "PING") == 0) {
        printf("OK PicoBridge\n");
    } else if (strcmp(line, "SCAN") == 0) {
        handle_scan();
    } else if (strncmp(line, "READ ", 5) == 0) {
        handle_read(line + 5);
    } else if (strncmp(line, "WRITE ", 6) == 0) {
        handle_write(line + 6);
    } else {
        printf("ERR unknown command\n");
    }
}

void command_run_loop(void) {
    printf("PicoBridge ready\n");
    char line[LINE_BUF_SIZE];
    while (true) {
        read_line(line, sizeof(line));
        handle_command(line);
    }
}
