#ifndef COMMAND_H
#define COMMAND_H

// Reads one text command per line from stdio (USB CDC) and executes it,
// forever. Protocol (see README.md): PING, SCAN, READ <addr> <memaddr> <len>,
// WRITE <addr> <memaddr> <len> (+ len raw bytes). Never returns.
void command_run_loop(void);

#endif
