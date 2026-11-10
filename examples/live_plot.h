#ifndef LIVE_PLOT_H
#define LIVE_PLOT_H

#include <cmath>
#include <initializer_list>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <utility>

#ifndef LIVE_PLOT_PORT
#define LIVE_PLOT_PORT 43173
#endif

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace live_plot {

inline std::string escapeJson(const std::string& value) {
    std::ostringstream result;
    for (unsigned char character : value) {
        switch (character) {
        case '"': result << "\\\""; break;
        case '\\': result << "\\\\"; break;
        case '\b': result << "\\b"; break;
        case '\f': result << "\\f"; break;
        case '\n': result << "\\n"; break;
        case '\r': result << "\\r"; break;
        case '\t': result << "\\t"; break;
        default:
            if (character < 0x20) {
                const char hex[] = "0123456789abcdef";
                result << "\\u00" << hex[character >> 4] << hex[character & 0x0f];
            } else {
                result << character;
            }
        }
    }
    return result.str();
}

class Connection {
#ifdef _WIN32
    typedef SOCKET Socket;
    static const Socket InvalidSocket = INVALID_SOCKET;
#else
    typedef int Socket;
    static const Socket InvalidSocket = -1;
#endif

public:
    Connection() : socket_(InvalidSocket)
#ifdef _WIN32
        , winsockStarted_(false)
#endif
    {}

    ~Connection() {
        disconnect();
#ifdef _WIN32
        if (winsockStarted_) {
            WSACleanup();
        }
#endif
    }

    bool write(const std::string& payload) {
        if (socket_ == InvalidSocket && !connectToReceiver()) {
            return false;
        }

        const char* data = payload.c_str();
        std::size_t remaining = payload.size();
        while (remaining > 0) {
#ifdef _WIN32
            const int sent = ::send(socket_, data, static_cast<int>(remaining), 0);
            if (sent == SOCKET_ERROR || sent == 0) {
                disconnect();
                return false;
            }
#else
            int flags = 0;
#ifdef MSG_NOSIGNAL
            flags = MSG_NOSIGNAL;
#endif
            const ssize_t sent = ::send(socket_, data, remaining, flags);
            if (sent <= 0) {
                disconnect();
                return false;
            }
#endif
            data += sent;
            remaining -= static_cast<std::size_t>(sent);
        }
        return true;
    }

private:
    bool connectToReceiver() {
#ifdef _WIN32
        if (!winsockStarted_) {
            WSADATA winsockData;
            if (WSAStartup(MAKEWORD(2, 2), &winsockData) != 0) {
                std::cerr << "Live Plot: could not initialize Winsock.\n";
                return false;
            }
            winsockStarted_ = true;
        }
        socket_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
        socket_ = ::socket(AF_INET, SOCK_STREAM, 0);
#endif
        if (socket_ == InvalidSocket) {
            return false;
        }

        sockaddr_in address = {};
        address.sin_family = AF_INET;
        address.sin_port = htons(LIVE_PLOT_PORT);
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (::connect(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
            disconnect();
            return false;
        }
        return true;
    }

    void disconnect() {
        if (socket_ == InvalidSocket) {
            return;
        }
#ifdef _WIN32
        closesocket(socket_);
#else
        close(socket_);
#endif
        socket_ = InvalidSocket;
    }

    Socket socket_;
#ifdef _WIN32
    bool winsockStarted_;
#endif
};

inline bool send(std::initializer_list<std::pair<const char*, double> > values) {
    static bool failureLogged = false;
    std::ostringstream message;
    message.precision(std::numeric_limits<double>::max_digits10);
    message << "{\"values\":{";
    bool first = true;
    for (const std::pair<const char*, double>& value : values) {
        if (!std::isfinite(value.second)) {
            std::cerr << "Live Plot: skipping non-finite value for " << value.first << '\n';
            continue;
        }
        if (!first) {
            message << ',';
        }
        first = false;
        message << '"' << escapeJson(value.first) << "\":" << value.second;
    }
    message << "}}\n";

    static Connection connection;
    const bool success = connection.write(message.str());
    if (!success) {
        if (!failureLogged) {
            std::cerr << "Live Plot: cannot connect to the VS Code extension on "
                      << "127.0.0.1:" << LIVE_PLOT_PORT
                      << ". Check that the extension is running and uses the same port.\n";
            failureLogged = true;
        }
    } else {
        failureLogged = false;
    }
    return success;
}

}

#define  LIVE_PLOT_VALUE(variable) { #variable, static_cast<double>(variable) }
#define LIVE_PLOT(...) ::live_plot::send({__VA_ARGS__})

#endif
